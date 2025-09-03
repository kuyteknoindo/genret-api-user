import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import saveAs from 'file-saver';
import JSZip from 'jszip';
import { GeneratedImage, ModalState, ReferenceFile, ActiveTab, ApiKey, ApiKeyStatus } from './types';
import { generateImage, generateText, generateConsistentCoupleDescription, generateLocationBasedScenarios, validateApiKey } from './services/geminiService';
import { shuffleArray, generateRandomFilename, cropImageToAspectRatio } from './utils';
import * as D from './creativeData';
import CommonModals from './components/modals/CommonModals';

const defaultInitialPrompt = ``;

// --- API Key Manager ---
const API_KEY_STORAGE_KEY = 'ai_photographer_api_keys';

const getStoredApiKeys = (): ApiKey[] => {
    try {
        const stored = localStorage.getItem(API_KEY_STORAGE_KEY);
        if (!stored) return [];

        const keys: Partial<ApiKey>[] = JSON.parse(stored);
        
        return keys.map((key, index) => ({
            id: key.id || `key_loaded_${Date.now()}_${index}`,
            value: key.value || '',
            masked: key.masked || (key.value ? `${key.value.slice(0, 4)}...${key.value.slice(-4)}` : ''),
            status: key.status || 'unvalidated', 
            isSystem: false,
        })).filter(key => key.value);

    } catch (e) {
        console.error("Failed to parse API keys from storage, clearing it.", e);
        localStorage.removeItem(API_KEY_STORAGE_KEY);
        return [];
    }
};

const storeApiKeys = (keys: ApiKey[]) => {
    const userKeys = keys.filter(k => !k.isSystem);
    localStorage.setItem(API_KEY_STORAGE_KEY, JSON.stringify(userKeys));
};
// --- End API Key Manager ---

const MainApp: React.FC = () => {
    const [prompt, setPrompt] = useState(defaultInitialPrompt);
    const [referenceFile, setReferenceFile] = useState<ReferenceFile | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [imageCount, setImageCount] = useState(6);
    const [delay, setDelay] = useState(5);
    const [locationTheme, setLocationTheme] = useState('Kehidupan Sehari-hari');
    const [activeTab, setActiveTab] = useState<ActiveTab>('prompt');
    const [imageModel, setImageModel] = useState('gemini-2.5-flash-image-preview');

    const [selectedNegativePrompts, setSelectedNegativePrompts] = useState<Set<string>>(new Set());
    const [customNegativePrompt, setCustomNegativePrompt] = useState('');

    const [isLoading, setIsLoading] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
    
    const [modals, setModals] = useState<ModalState>({ error: null, download: false, lightbox: null });
    const [isApiModalOpen, setIsApiModalOpen] = useState(false);
    const [isAllKeysFailedModalOpen, setIsAllKeysFailedModalOpen] = useState(false);
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [isKeyValidationLoading, setIsKeyValidationLoading] = useState(false);
    const [activeApiKeyMasked, setActiveApiKeyMasked] = useState<string | null>(null);

    const [previewData, setPreviewData] = useState<{ textPrompt: string; imageUrl: string | null; isLoading: boolean; error: string | null; statusText: string } | null>(null);
    const [adatPreviewData, setAdatPreviewData] = useState<{
        region: string;
        textPrompt: string;
        imageUrl: string | null;
        isLoading: boolean;
        error: string | null;
        statusText: string;
    } | null>(null);

    const [isEnhancing, setIsEnhancing] = useState(false);
    const [consistentCoupleDescription, setConsistentCoupleDescription] = useState('');
    const [sessionFinished, setSessionFinished] = useState(false);
    const [sessionTargetCount, setSessionTargetCount] = useState(0);
    
    const isGenerationRunningRef = useRef(false);
    const sessionReferenceImageRef = useRef<ReferenceFile | null>(null);
    const previewCancellationRef = useRef(false);

    useEffect(() => {
        const userKeys = getStoredApiKeys();
        const systemApiKey = process.env.API_KEY;
        
        const systemKey: ApiKey[] = systemApiKey ? [{
            id: 'system_key',
            value: systemApiKey,
            masked: 'Kunci Sistem',
            status: 'unvalidated',
            isSystem: true
        }] : [];
        
        setApiKeys([...systemKey, ...userKeys]);
    }, []);

    const hasApiKeyIssue = useMemo(() => {
        if (apiKeys.length === 0) return true;
        return apiKeys.every(k => k.status === 'invalid' || k.status === 'exhausted');
    }, [apiKeys]);

    const performApiCall = async <T,>(apiFunction: (apiKey: string) => Promise<T>, onStatusUpdate: (status: string) => void): Promise<T> => {
        const availableKeys = apiKeys.filter(k => k.status === 'active' || k.status === 'unvalidated');
    
        if (availableKeys.length === 0) {
            setActiveApiKeyMasked(null);
            throw new Error("ALL_KEYS_FAILED: Tidak ada kunci API yang aktif. Silakan tambahkan kunci API Anda sendiri untuk menggunakan aplikasi ini.");
        }

        const updateKeyStatus = (keyId: string, newStatus: ApiKeyStatus) => {
            setApiKeys(prev => {
                const updated = prev.map(k => k.id === keyId ? { ...k, status: newStatus } : k);
                storeApiKeys(updated);
                return updated;
            });
        };
    
        for (const keyToTry of availableKeys) {
            let attempts = 0;
            const maxAttempts = 3;
    
            while (attempts < maxAttempts) {
                try {
                    setActiveApiKeyMasked(`Menggunakan: ${keyToTry.masked}`);
                    const result = await apiFunction(keyToTry.value);
    
                    if (keyToTry.status === 'unvalidated') {
                        updateKeyStatus(keyToTry.id, 'active');
                    }
    
                    return result; // Success!
    
                } catch (error) {
                    const e = error as Error;
                    const errorMessage = e.message || '';
    
                    if (errorMessage.includes('API key not valid')) {
                        console.warn(`API key ${keyToTry.masked} is invalid.`);
                        updateKeyStatus(keyToTry.id, 'invalid');
                        break; // Stop trying this invalid key
                    }

                    if (errorMessage.includes("SAFETY_BLOCK")) {
                        console.error(`Request blocked due to safety settings for key ${keyToTry.masked}.`, e);
                        // This error is not recoverable by retrying with another key, so we throw it immediately.
                        throw new Error(`Permintaan diblokir karena kebijakan keamanan. Coba ubah prompt Anda.`);
                    }
    
                    if ((errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED'))) {
                        attempts++;
                        if (attempts < maxAttempts) {
                            console.warn(`API key ${keyToTry.masked} hit a rate limit. Attempt ${attempts}/${maxAttempts}.`);
                            
                            let delaySeconds = 20 * attempts;
                            try {
                                const errorJsonString = errorMessage.substring(errorMessage.indexOf('{'));
                                const errorJson = JSON.parse(errorJsonString);
                                const retryDetail = errorJson.error?.details?.find((d: any) => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
                                if (retryDetail && retryDetail.retryDelay) {
                                    const parsedDelay = parseInt(retryDetail.retryDelay.replace('s', ''), 10);
                                    if (!isNaN(parsedDelay)) {
                                        delaySeconds = parsedDelay;
                                    }
                                }
                            } catch (parseError) {
                                console.warn("Could not parse retryDelay from error message.", parseError);
                            }
                            
                            onStatusUpdate(`Batas kuota tercapai. Mencoba lagi dalam ${delaySeconds} detik...`);
                            await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
                            onStatusUpdate(`Mencoba kembali... (Percobaan ${attempts + 1}/${maxAttempts})`);
                            continue; // Retry with the same key
                        } else {
                             console.error(`API call failed for key ${keyToTry.masked} after ${attempts} attempts.`, e);
                             updateKeyStatus(keyToTry.id, 'exhausted');
                             break;
                        }
                    }
    
                    console.error(`API call failed for key ${keyToTry.masked}.`, e);
                    break; 
                }
            } // end while
        } // end for
    
        setActiveApiKeyMasked(null);
        throw new Error("ALL_KEYS_FAILED: Semua kunci API yang tersedia gagal atau kuotanya habis. Periksa kunci Anda atau coba lagi nanti.");
    };


    const locationGroups = useMemo(() => ({
        "Studio & Konsep": ["Studio Foto Profesional"],
        "Indonesia": ["Kehidupan Sehari-hari", "Kisah Kampus", "Pasar Tradisional", "Kota Tua", "Toko Batik", "Pedesaan", "Hutan Tropis", "Street Food", "Bali", "Yogyakarta", "Bromo", "Raja Ampat", "Sumba", "Danau Toba"],
        "Asia Pasifik": ["Tokyo", "Kyoto", "Nara (Jepang)", "Seoul (Korea)", "Thailand", "Vietnam", "Singapura", "Selandia Baru", "Australia"],
        "Eropa": ["Paris", "Santorini", "Roma", "Venesia", "London", "Praha", "Tuscany", "Swiss", "Islandia"],
        "Amerika & Timur Tengah": ["New York City", "Grand Canyon", "California", "Cappadocia (Turki)", "Dubai", "Maroko"],
    }), []);

    const handleFileChange = (file: File | null) => {
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const result = e.target?.result as string;
                const [header, base64] = result.split(',');
                const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
                setReferenceFile({ base64, mimeType });
                setImagePreview(result);
            };
            reader.readAsDataURL(file);
        } else {
            setModals(prev => ({ ...prev, error: 'Harap unggah file gambar yang valid.' }));
            setReferenceFile(null);
            setImagePreview(null);
        }
    };

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.currentTarget.classList.remove('border-lime-500', 'bg-gray-700');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileChange(e.dataTransfer.files[0]);
            e.dataTransfer.clearData();
        }
    }, []);
    
    const handleCancelPreviews = () => {
        previewCancellationRef.current = true;
        setPreviewData(null);
        setAdatPreviewData(null);
        setActiveApiKeyMasked(null);
    };

    const handleGenerateCasualPreview = async () => {
        previewCancellationRef.current = false;
        setPreviewData({ textPrompt: '', imageUrl: null, isLoading: true, error: null, statusText: 'Membuat deskripsi pakaian...' });
        try {
            const randomMaleCloth = D.maleClothing[Math.floor(Math.random() * D.maleClothing.length)];
            const randomMalePants = D.malePants[Math.floor(Math.random() * D.malePants.length)];
            const randomFemaleOption = D.femaleClothingOptions[Math.floor(Math.random() * D.femaleClothingOptions.length)];
            const randomAcc1 = D.accessories[Math.floor(Math.random() * D.accessories.length)];
            
            const femaleDescription = `The female, ${randomFemaleOption.style}, wears ${randomFemaleOption.clothing}${randomFemaleOption.bottom ? ` paired with ${randomFemaleOption.bottom}` : ''}.`;
            const maleDescription = `The male wears ${randomMaleCloth} and ${randomMalePants}.`;
            const accessoryDescription = `They both share a stylish, serene presence, accessorized with items like ${randomAcc1}.`;
            const fullPrompt = `A young Indonesian couple. ${femaleDescription} ${maleDescription} ${accessoryDescription}`;

            if (previewCancellationRef.current) return;
            setPreviewData(p => ({ ...p!, textPrompt: fullPrompt, statusText: 'Membuat preview gambar...' }));
            
            const onUpdate = (status: string) => {
                if (previewCancellationRef.current) return;
                setPreviewData(p => ({ ...(p!), statusText: status }));
            };

            const imageGenPrompt = `Photorealistic 4k cinematic preview, 3:4 aspect ratio. A young Indonesian couple, their appearance and clothing are described as: "${fullPrompt}". **Must be ethnically Indonesian.** Only one man and one woman. No cartoons.`;
            const imageUrl = await performApiCall(apiKey => generateImage(apiKey, imageGenPrompt, 'gemini-2.5-flash-image-preview'), onUpdate);

            if (previewCancellationRef.current) return;
            setPreviewData({ textPrompt: fullPrompt, imageUrl, isLoading: false, error: null, statusText: '' });

        } catch (error) {
            if (previewCancellationRef.current) return;
            console.error("Error generating preview:", error);
            const e = error as Error;
            if (e.message.startsWith("ALL_KEYS_FAILED:")) {
                 setIsAllKeysFailedModalOpen(true);
                 setPreviewData(prev => ({ ...(prev ?? { textPrompt: '', imageUrl: null, isLoading: false, error: null, statusText: '' }), isLoading: false, error: `Gagal membuat preview: Kunci API tidak valid atau habis.` }));
            } else {
                const errorMessage = e.message;
                setPreviewData(prev => ({ ...(prev ?? { textPrompt: '', imageUrl: null, isLoading: false, error: null, statusText: '' }), isLoading: false, error: `Gagal membuat preview: ${errorMessage}` }));
            }
        } finally {
            if (previewCancellationRef.current) return;
            setActiveApiKeyMasked(null);
        }
    };

    const handleGenerateAdatPreview = async () => {
        const region = adatPreviewData?.region;
        if (!region) {
            setAdatPreviewData(prev => ({ ...(prev!), error: "Harap masukkan daerah asal pakaian adat." }));
            return;
        }
        
        previewCancellationRef.current = false;
        setAdatPreviewData(prev => ({ ...(prev!), imageUrl: null, textPrompt: '', isLoading: true, error: null, statusText: `Membuat deskripsi untuk pakaian adat ${region}...` }));

        try {
            const onUpdate = (status: string) => {
                 if (previewCancellationRef.current) return;
                setAdatPreviewData(p => ({ ...(p!), statusText: status }));
            };

            const textGenPrompt = `Create a concise, culturally rich English description for an AI photo prompt. Subject: A couple in complete traditional wedding attire from the ${region} region of Indonesia. Focus on key visual elements: specific garment names, patterns (batik, songket), and accessories (blangkon, sanggul).`;
            const generatedText = await performApiCall(apiKey => generateText(apiKey, textGenPrompt), onUpdate);

            if (previewCancellationRef.current) return;
            setAdatPreviewData(prev => ({ ...(prev!), textPrompt: generatedText, statusText: 'Membuat preview gambar...' }));
            
            const imageGenPrompt = `Photorealistic 4k cinematic preview, 3:4 aspect ratio. Description: "${generatedText}". **CRITICAL: The couple must be ethnically Indonesian, with features authentic to the ${region} region.** Culturally accurate attire. No cartoons.`;
            const imageUrl = await performApiCall(apiKey => generateImage(apiKey, imageGenPrompt, 'gemini-2.5-flash-image-preview'), onUpdate);

            if (previewCancellationRef.current) return;
            setAdatPreviewData(prev => ({ ...(prev!), imageUrl, isLoading: false, statusText: '' }));

        } catch (error) {
            if (previewCancellationRef.current) return;
            console.error("Error generating adat preview:", error);
            const e = error as Error;
            if (e.message.startsWith("ALL_KEYS_FAILED:")) {
                 setIsAllKeysFailedModalOpen(true);
                 setAdatPreviewData(prev => ({ ...(prev!), isLoading: false, error: `Gagal membuat preview: Kunci API tidak valid atau habis.`, statusText: '' }));
            } else {
                const errorMessage = e.message;
                setAdatPreviewData(prev => ({ ...(prev!), isLoading: false, error: `Gagal membuat preview: ${errorMessage}`, statusText: '' }));
            }
        } finally {
            if (previewCancellationRef.current) return;
            setActiveApiKeyMasked(null);
        }
    };
    
    const handleUseInspiration = (text: string, imageUrl: string) => {
        setPrompt(''); // Clear the prompt to avoid sending redundant text with the image reference.

        const [header, base64] = imageUrl.split(',');
        const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
        
        setReferenceFile({ base64, mimeType });
        setImagePreview(imageUrl);
        
        setActiveTab('reference');
        
        setPreviewData(null);
        setAdatPreviewData(null);
    };

    const handleEnhancePrompt = async () => {
        if (!prompt) {
            setModals(prev => ({...prev, error: "Tulis deskripsi terlebih dahulu untuk ditingkatkan."}));
            return;
        }
        setIsEnhancing(true);
        try {
            const enhancementInstruction = `Enhance this user's description into a rich, detailed, and evocative prompt for an AI pre-wedding photo generator. Add cinematic lighting, emotional cues, and artistic composition, focusing on Indonesian cultural context. Output a single, cohesive paragraph. User description: "${prompt}"`;
            const enhancedPrompt = await performApiCall(apiKey => generateText(apiKey, enhancementInstruction), () => {}); // No status update needed for this simple action
            setPrompt(enhancedPrompt);
        } catch (error) {
            const e = error as Error;
            if (e.message.startsWith("ALL_KEYS_FAILED:")) {
                 setIsAllKeysFailedModalOpen(true);
            } else {
                const errorMessage = e.message;
                setModals(prev => ({...prev, error: `Gagal meningkatkan prompt: ${errorMessage}`}));
            }
        } finally {
            setIsEnhancing(false);
            setActiveApiKeyMasked(null);
        }
    };

    const toggleNegativePrompt = (tag: string) => {
        setSelectedNegativePrompts(prev => {
            const newSet = new Set(prev);
            if (newSet.has(tag)) {
                newSet.delete(tag);
            } else {
                newSet.add(tag);
            }
            return newSet;
        });
    };

    const runGeneration = async (isContinuation = false, overrideCount?: number) => {
        if (isGenerationRunningRef.current) return;
    
        const isReferenceTabActive = activeTab === 'reference';
        if (isReferenceTabActive && !referenceFile) {
            setModals(prev => ({ ...prev, error: 'Harap unggah foto referensi terlebih dahulu.' }));
            return;
        }
        if (activeTab === 'prompt' && !prompt) {
            setModals(prev => ({ ...prev, error: 'Harap isi deskripsi pasangan di tab "Teks Prompt".' }));
            return;
        }
    
        isGenerationRunningRef.current = true;
        setIsLoading(true);
        const countForThisRun = overrideCount ?? imageCount;

        if (!isContinuation) {
            setGeneratedImages([]);
            setSessionFinished(false);
            setSessionTargetCount(countForThisRun);
            sessionReferenceImageRef.current = null;
        } else if (!overrideCount) { // Only update target for "Lanjutkan", not for "Selesaikan"
            setSessionTargetCount(prev => prev + countForThisRun);
        }
    
        let baseDescription = consistentCoupleDescription || prompt;
        let scenarios: { scene: string; emotion: string }[] = [];
    
        try {
            // Step 1: Create consistent description if starting from text prompt
            if (!isContinuation && activeTab === 'prompt' && prompt) {
                setStatusText('Membuat deskripsi pasangan yang konsisten...');
                const coupleDesc = await performApiCall(apiKey => generateConsistentCoupleDescription(apiKey, prompt), setStatusText);
                setConsistentCoupleDescription(coupleDesc);
                baseDescription = coupleDesc;
            } else if (isReferenceTabActive) {
                setConsistentCoupleDescription('');
            }
    
            // Step 2: Generate all creative scenarios at once, with fallback
            setStatusText(`Membuat skenario kreatif untuk ${locationTheme}...`);
            try {
                scenarios = await performApiCall(apiKey => generateLocationBasedScenarios(apiKey, locationTheme, countForThisRun), setStatusText);
            } catch (error) {
                 console.warn("Creative scenario generation failed. Falling back to generic scenarios.", error);
                 setStatusText(`Skenario kreatif gagal, menggunakan skenario cadangan...`);
                 scenarios = shuffleArray<any>(D.storyScenes)
                     .slice(0, countForThisRun)
                     .map(scene => ({
                         scene,
                         emotion: shuffleArray<string>(D.emotionalCues)[0]
                     }));
            }

            if (scenarios.length < countForThisRun) {
                const fallback = { scene: 'The couple shares a quiet, intimate moment.', emotion: 'A feeling of deep connection.' };
                scenarios.push(...Array(countForThisRun - scenarios.length).fill(fallback));
            }
            
            setStatusText(`Persiapan selesai. Memulai sesi foto...`);
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Step 3: Loop through and generate images
            const startIndex = isContinuation ? generatedImages.length : 0;
            const targetCount = startIndex + countForThisRun;
    
            for (let i = startIndex; i < targetCount; i++) {
                if (!isGenerationRunningRef.current) break;
    
                const scenarioIndex = i - startIndex;
                const scenario = scenarios[scenarioIndex % scenarios.length];
                const photoStyle = shuffleArray(D.photographicStyles)[0];
                const negativePrompt = [
                    ...Array.from(selectedNegativePrompts),
                    ...customNegativePrompt.split(',').map(s => s.trim()).filter(Boolean)
                ].join(', ');
                
                setStatusText(`Gambar ${i + 1}/${sessionTargetCount} | ${scenario.scene.substring(0, 50)}...`);
    
                let finalPrompt: string;
                let imageUrl: string;
    
                const useVisualReference = 
                    (isReferenceTabActive && referenceFile) ||
                    (activeTab === 'prompt' && imageModel === 'gemini-2.5-flash-image-preview' && sessionReferenceImageRef.current);
    
                const currentReference = isReferenceTabActive ? referenceFile : sessionReferenceImageRef.current;
    
                if (useVisualReference && currentReference) {
                    finalPrompt = `Photorealistic 4k prewedding photo. **Use the reference image for the couple's exact appearance (faces, clothes). Maintain their Indonesian ethnicity.**
- New Scene (${locationTheme}): ${scenario.scene}
- Emotion: ${scenario.emotion}
- Style: ${photoStyle}
${prompt && isReferenceTabActive ? `- User Notes: ${prompt}\n` : ''}- Negative Prompts: ${negativePrompt || 'None'}`;
                    imageUrl = await performApiCall(apiKey => generateImage(apiKey, finalPrompt, imageModel, currentReference.base64, currentReference.mimeType), setStatusText);
                } else {
                     finalPrompt = `Photorealistic 4k cinematic prewedding photo of a young **Indonesian couple with authentic Southeast Asian features.**
- **Appearance (Strictly follow):** "${baseDescription}"
- **Location:** ${locationTheme}
- **Scene:** ${scenario.scene}
- **Emotion:** ${scenario.emotion}
- **Style:** ${photoStyle}
- **Negative Prompts:** ${negativePrompt || 'None'}`;
                    
                    imageUrl = await performApiCall(apiKey => generateImage(apiKey, finalPrompt, imageModel), setStatusText);
    
                    if (activeTab === 'prompt' && imageModel === 'gemini-2.5-flash-image-preview' && i === startIndex) {
                        const [header, base64] = imageUrl.split(',');
                        const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
                        sessionReferenceImageRef.current = { base64, mimeType };
                    }
                }
    
                setGeneratedImages(prev => [...prev, { id: generateRandomFilename(), url: imageUrl }]);
    
                if (i < targetCount - 1 && delay > 0 && isGenerationRunningRef.current) {
                    setStatusText(`Gambar ${i + 1} berhasil. Jeda ${delay} detik...`);
                    await new Promise(resolve => setTimeout(resolve, delay * 1000));
                }
            }
    
        } catch (error) {
            const e = error as Error;
            if (e.message.startsWith("ALL_KEYS_FAILED:")) {
                setIsAllKeysFailedModalOpen(true);
            } else {
                setModals(prev => ({ ...prev, error: `Sesi foto gagal: ${e.message}` }));
            }
        } finally {
            if (isGenerationRunningRef.current) {
                setStatusText("Sesi foto selesai!");
            } else {
                setStatusText("Proses dihentikan.");
            }
            setIsLoading(false);
            isGenerationRunningRef.current = false;
            setSessionFinished(true);
            setActiveApiKeyMasked(null);
        }
    };
    
    const handleCompleteFailedSession = () => {
        const remaining = sessionTargetCount - generatedImages.length;
        if (remaining > 0) {
            runGeneration(true, remaining);
        }
    };

    const handleStop = () => {
        isGenerationRunningRef.current = false;
        setStatusText("Menghentikan proses...");
        setActiveApiKeyMasked(null);
    }
    
    const handleDownloadZip = async (aspectRatio?: number) => {
        setModals(prev => ({...prev, download: false}));
        const zip = new JSZip();

        for (const image of generatedImages) {
            try {
                let blob = await fetch(image.url).then(res => res.blob());
                if (aspectRatio) {
                    blob = await cropImageToAspectRatio(blob, aspectRatio);
                }
                zip.file(generateRandomFilename('prewedding', 'jpeg'), blob);
            } catch (e) {
                console.error("Failed to process image for download:", image.url, e);
            }
        }
        
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, generateRandomFilename('prewedding_collection', 'zip'));
    };
    
    const handleDownloadSingle = (url: string) => {
        saveAs(url, generateRandomFilename('prewedding_photo', 'jpeg'));
    };
    
    const handleClearAll = () => {
        setGeneratedImages([]);
        setSessionFinished(false);
        setConsistentCoupleDescription('');
        setSessionTargetCount(0);
        setStatusText('');
        sessionReferenceImageRef.current = null;
    };

    const handleSaveApiKeys = () => {
        const keysFromInput = apiKeyInput.split('\n').map(k => k.trim()).filter(Boolean);
        if (keysFromInput.length === 0) return;

        const existingValues = new Set(apiKeys.map(k => k.value));
        const newApiKeys: ApiKey[] = keysFromInput
            .filter(k => !existingValues.has(k)) // Filter out keys that already exist
            .map(k => ({
                id: `key_${Date.now()}_${Math.random()}`,
                value: k,
                masked: `${k.slice(0, 4)}...${k.slice(-4)}`,
                status: 'unvalidated',
                isSystem: false
            }));

        const updatedKeys = [...apiKeys, ...newApiKeys];
        setApiKeys(updatedKeys);
        storeApiKeys(updatedKeys);
        setApiKeyInput('');
    };

    const handleValidateKeys = async () => {
        if (isKeyValidationLoading || apiKeys.length === 0) return;
        setIsKeyValidationLoading(true);
    
        const validationPromises = apiKeys.map(async (key) => {
            const status = await validateApiKey(key.value);
            return { ...key, status };
        });

        const updatedKeys = await Promise.all(validationPromises);
        
        setApiKeys(updatedKeys);
        storeApiKeys(updatedKeys);
        setIsKeyValidationLoading(false);
    };

    const handleRemoveApiKey = (idToRemove: string) => {
        const newKeys = apiKeys.filter(k => k.id !== idToRemove);
        setApiKeys(newKeys);
        storeApiKeys(newKeys);
    };
    
    const isSessionIncomplete = sessionFinished && generatedImages.length > 0 && generatedImages.length < sessionTargetCount;
    
    const commonFormElements = (
        <div className="flex flex-col flex-grow">
            <div className="space-y-6 flex-grow">
                <div>
                    <label htmlFor="image-model" className="block text-sm font-medium text-gray-300 mb-2">2. Pilih Model AI</label>
                    <select id="image-model" value={imageModel} onChange={e => setImageModel(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 focus:ring-lime-500 focus:border-lime-500 transition-colors">
                        <option value="gemini-2.5-flash-image-preview">Gemini Flash (Cepat & Fleksibel)</option>
                        <option value="imagen-4.0-generate-001">Imagen 4 (Kualitas Tertinggi)</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1.5">Gemini mendukung referensi gambar, Imagen hanya teks.</p>
                </div>
                <div>
                    <label htmlFor="location-theme" className="block text-sm font-medium text-gray-300 mb-2">3. Pilih Tema Sesi Foto</label>
                    <select id="location-theme" value={locationTheme} onChange={e => setLocationTheme(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 focus:ring-lime-500 focus:border-lime-500 transition-colors">
                        {Object.entries(locationGroups).map(([groupName, locations]) => (
                            <optgroup key={groupName} label={groupName}>
                                {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                            </optgroup>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">4. Hindari Elemen (Negative Prompt)</label>
                    <div className="flex flex-wrap gap-2 mb-2">
                        {D.negativePromptOptions.map(tag => (
                            <button key={tag} onClick={() => toggleNegativePrompt(tag)} className={`negative-prompt-tag ${selectedNegativePrompts.has(tag) ? 'negative-prompt-tag-selected' : ''}`}>
                                {tag}
                            </button>
                        ))}
                    </div>
                    <input type="text" value={customNegativePrompt} onChange={e => setCustomNegativePrompt(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 focus:ring-lime-500 focus:border-lime-500 placeholder-gray-500 transition-colors" placeholder="Atau tulis sendiri (pisahkan dengan koma), e.g., blurry, text, extra people" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="image-count" className="block text-sm font-medium text-gray-300 mb-2">5. Jumlah Foto</label>
                        <input type="number" id="image-count" value={imageCount} onChange={e => setImageCount(parseInt(e.target.value))} min="1" max="50" className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 focus:ring-lime-500 focus:border-lime-500" />
                    </div>
                    <div>
                        <label htmlFor="delay" className="block text-sm font-medium text-gray-300 mb-2">Jeda (detik)</label>
                        <input type="number" id="delay" value={delay} onChange={e => setDelay(parseInt(e.target.value))} min="0" max="60" className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 focus:ring-lime-500 focus:border-lime-500" />
                    </div>
                </div>
            </div>
            <div className="mt-auto pt-6">
                {!isLoading ? (
                    <button onClick={() => runGeneration()} className="w-full bg-lime-400 text-gray-900 font-bold py-4 px-4 rounded-xl shadow-lg shadow-lime-500/10 hover:bg-lime-500 transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-lime-500/50 disabled:bg-gray-600 disabled:shadow-none disabled:cursor-not-allowed" disabled={hasApiKeyIssue}>
                        {hasApiKeyIssue ? 'Periksa Kunci API' : 'Mulai Sesi Foto'}
                    </button>
                ) : (
                    <button onClick={handleStop} className="w-full bg-red-600 text-white font-bold py-4 px-4 rounded-xl shadow-lg shadow-red-500/10 hover:bg-red-700 transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-red-500/50">
                        Hentikan
                    </button>
                )}
                 {sessionFinished && !isLoading && (
                    <div className="mt-4 flex flex-col gap-2">
                         {isSessionIncomplete ? (
                            <button onClick={handleCompleteFailedSession} disabled={hasApiKeyIssue} className="w-full text-sm bg-yellow-500 text-gray-900 font-semibold py-3 px-4 rounded-md hover:bg-yellow-600 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed">
                                Selesaikan Sesi ({sessionTargetCount - generatedImages.length} foto lagi)
                            </button>
                         ) : (
                            generatedImages.length > 0 && (
                                <button onClick={() => runGeneration(true)} disabled={hasApiKeyIssue} className="w-full text-sm bg-blue-600 text-white font-semibold py-3 px-4 rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed">
                                    Lanjutkan (+{imageCount} foto)
                                </button>
                            )
                         )}
                    </div>
                )}
            </div>
        </div>
    );
    
    return (
        <div className="min-h-screen bg-black text-gray-200 p-4 lg:p-6 flex flex-col lg:flex-row gap-6 relative">
            <aside className="w-full lg:w-1/3 xl:w-[420px] bg-[#111827] p-6 rounded-2xl shadow-2xl shadow-lime-500/5 custom-scrollbar overflow-y-auto flex flex-col">
                <div className="sticky top-0 bg-[#111827] py-4 z-10 flex justify-between items-center -mx-6 px-6 border-b border-gray-700 mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-white">AI Photographer</h1>
                        <p className="text-sm text-gray-400 mt-1">Prewedding Edition</p>
                    </div>
                     <div className="relative">
                        <button onClick={() => setIsApiModalOpen(true)} className="p-2 border border-gray-700 rounded-full hover:bg-gray-800 transition-colors" title="Kelola API Key">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-gray-300" viewBox="0 0 512 512" fill="currentColor">
                                <path d="m442.086 316.459v-120.918c23.268-1.776 41.662-21.263 41.662-44.979 0-24.882-20.243-45.125-45.125-45.125-15.432 0-29.073 7.791-37.214 19.641l-104.718-60.458c2.84-5.904 4.434-12.517 4.434-19.495 0-24.882-20.243-45.125-45.125-45.125s-45.125 20.243-45.125 45.125c0 6.978 1.593 13.591 4.433 19.495l-104.717 60.458c-8.141-11.85-21.783-19.641-37.214-19.641-24.882 0-45.125 20.243-45.125 45.125 0 23.716 18.394 43.203 41.662 44.979v120.917c-23.268 1.776-41.662 21.263-41.662 44.979 0 24.882 20.243 45.125 45.125 45.125 15.432 0 29.073-7.791 37.214-19.641l104.717 60.458c-2.84 5.904-4.433 12.517-4.433 19.495 0 24.883 20.243 45.126 45.125 45.126s45.125-20.243 45.125-45.125c0-6.978-1.593-13.591-4.434-19.495l104.717-60.458c8.141 11.85 21.783 19.641 37.214 19.641 24.882 0 45.125-20.243 45.125-45.125.001-23.716-18.393-43.203-41.661-44.979zm-186.086 105.291c-6.523 0-12.72 1.402-18.324 3.903l-119.423-68.949c-1.363-13.016-8.285-24.395-18.338-31.732v-137.945c10.053-7.337 16.975-18.716 18.338-31.732l119.423-68.949c5.604 2.501 11.802 3.903 18.324 3.903s12.72-1.402 18.324-3.903l119.424 68.949c1.363 13.016 8.285 24.395 18.338 31.732v137.945c-10.053 7.337-16.975-18.716-18.338-31.732l-119.424 68.949c-5.604-2.501-11.802-3.903-18.324-3.903zm182.623-286.312c8.34 0 15.125 6.785 15.125 15.125s-6.785 15.125-15.125 15.125-15.125-6.785-15.125-15.125 6.785-15.125 15.125-15.125zm-182.623-105.438c8.34 0 15.125 6.785 15.125 15.125s-6.785 15.125-15.125 15.125-15.125-6.785-15.125-15.125 6.785-15.125 15.125-15.125zm-197.748 120.562c0-8.34 6.785-15.125 15.125-15.125s15.125 6.785 15.125 15.125-6.785 15.125-15.125 15.125-15.125-6.785-15.125-15.125zm15.125 226c-8.34 0-15.125-6.785-15.125-15.125s6.785-15.125 15.125-15.125 15.125 6.785 15.125 15.125-6.785 15.125-15.125 15.125zm182.623 105.438c-8.34 0-15.125-6.785-15.125-15.125s6.785-15.125 15.125-15.125 15.125 6.785 15.125 15.125-6.785 15.125-15.125 15.125zm182.623-105.438c-8.34 0-15.125-6.785-15.125-15.125s6.785-15.125 15.125-15.125 15.125 6.785 15.125 15.125-6.785 15.125-15.125 15.125z" />
                                <path d="m177.625 187.812c-24.882 0-45.125 20.243-45.125 45.125v91.25h30v-53.187h30.25v53.188h30v-91.25c0-24.882-20.243-45.126-45.125-45.126zm-15.125 53.188v-8.062c0-8.34 6.785-15.125 15.125-15.125s15.125 6.785 15.125 15.125v8.062z" />
                                <path d="m289.656 187.812h-48.656v136.375h30v-53.187h18.656c22.935 0 41.594-18.659 41.594-41.594s-18.659-41.594-41.594-41.594zm0 53.188h-18.656v-23.188h18.656c6.393 0 11.594 5.201 11.594 11.594s-5.201 11.594-11.594 11.594z" />
                                <path d="m349.5 187.812h30v136.375h-30z" />
                            </svg>
                        </button>
                        {hasApiKeyIssue && <span className="absolute top-0 right-0 block h-3 w-3 rounded-full bg-red-500 ring-2 ring-gray-800"></span>}
                    </div>
                </div>
                
                <div className="flex-grow flex flex-col">
                    <div className="mb-6">
                        <div className="flex border border-gray-700 rounded-lg p-1 bg-gray-900">
                            <button onClick={() => setActiveTab('prompt')} className={`w-1/2 py-2.5 text-sm font-semibold rounded-md transition-colors ${activeTab === 'prompt' ? 'bg-lime-400 text-gray-900' : 'text-gray-300 hover:bg-gray-800'}`}>1. Teks Prompt</button>
                            <button onClick={() => setActiveTab('reference')} className={`w-1/2 py-2.5 text-sm font-semibold rounded-md transition-colors ${activeTab === 'reference' ? 'bg-lime-400 text-gray-900' : 'text-gray-300 hover:bg-gray-800'}`}>1. Foto Referensi</button>
                        </div>
                    </div>
                    
                    {activeTab === 'prompt' && (
                        <div className="flex flex-col flex-grow space-y-4">
                           <div>
                                <label htmlFor="prompt-input" className="block text-sm font-medium text-gray-300 mb-2">Deskripsi Pasangan & Pakaian</label>
                                <textarea id="prompt-input" value={prompt} onChange={e => setPrompt(e.target.value)} rows={6} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 focus:ring-lime-500 focus:border-lime-500 placeholder-gray-500" placeholder="Jelaskan penampilan pasangan, pakaian, gaya rambut, dll."></textarea>
                                <div className="flex justify-between items-center mt-2">
                                    <div className="flex gap-2">
                                        <button onClick={() => setPreviewData({ textPrompt: '', imageUrl: null, isLoading: false, error: null, statusText: '' })} disabled={hasApiKeyIssue} className="text-xs font-semibold bg-gray-800 border border-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Pakaian Casual</button>
                                        <button onClick={() => setAdatPreviewData({ region: '', textPrompt: '', imageUrl: null, isLoading: false, error: null, statusText: '' })} disabled={hasApiKeyIssue} className="text-xs font-semibold bg-gray-800 border border-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Pakaian Adat</button>
                                    </div>
                                    <button onClick={handleEnhancePrompt} disabled={isEnhancing || hasApiKeyIssue} className="text-xs font-semibold bg-gray-800 border border-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{isEnhancing ? 'Meningkatkan...' : 'Enhanced'}</button>
                                </div>
                           </div>
                           {commonFormElements}
                        </div>
                    )}

                    {activeTab === 'reference' && (
                        <div className="flex flex-col flex-grow space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Unggah Foto Referensi</label>
                                <div onDrop={handleDrop} onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-lime-500', 'bg-gray-700'); }} onDragLeave={e => e.currentTarget.classList.remove('border-lime-500', 'bg-gray-700')} className="relative flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-gray-600 rounded-lg cursor-pointer hover:border-lime-500 transition-colors bg-gray-800/50">
                                    {imagePreview ? (
                                        <>
                                            <img src={imagePreview} alt="Preview" className="absolute inset-0 w-full h-full object-cover rounded-lg opacity-40"/>
                                            <div className="relative z-10 text-center p-2 bg-black/50 rounded-lg">
                                                <p className="text-sm font-semibold">Gambar Terpilih</p>
                                                <p className="text-xs text-gray-400 mt-1">Ganti dengan file lain</p>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-center">
                                            <p className="text-sm text-gray-400">Seret & lepas file, atau klik untuk memilih</p>
                                            <p className="text-xs text-gray-500 mt-1">Hanya didukung oleh model Gemini</p>
                                        </div>
                                    )}
                                    <input type="file" onChange={e => handleFileChange(e.target.files?.[0] ?? null)} accept="image/*" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                                </div>
                            </div>
                            <div>
                               <label htmlFor="ref-prompt-input" className="block text-sm font-medium text-gray-300 mb-2">Catatan Tambahan (Opsional)</label>
                               <textarea id="ref-prompt-input" value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 focus:ring-lime-500 focus:border-lime-500 placeholder-gray-500" placeholder="Contoh: Ubah pakaian menjadi gaun malam, buat rambutnya lebih panjang."></textarea>
                            </div>
                            {commonFormElements}
                        </div>
                    )}
                </div>
            </aside>
            <main className="w-full lg:flex-1 bg-[#111827] rounded-2xl p-4 sm:p-6 lg:p-8 flex flex-col">
                {/* Case 1: Initial loading screen (no images yet) */}
                {isLoading && generatedImages.length === 0 && (
                    <div className="flex-grow flex flex-col items-center justify-center text-center">
                        <div className="loader"></div>
                        <p className="text-lg font-semibold mt-6 text-white">{statusText}</p>
                        <div className="text-sm text-gray-400 mt-2 max-w-sm">
                            <p>AI sedang bekerja... Proses ini bisa memakan waktu beberapa menit.</p>
                            {activeApiKeyMasked && <p>{activeApiKeyMasked}</p>}
                        </div>
                    </div>
                )}

                {/* Case 2: Welcome screen (no loading, no images) */}
                {!isLoading && generatedImages.length === 0 && (
                    <div className="flex-grow flex items-center justify-center text-center">
                        <div>
                            <h2 className="text-2xl font-bold text-white">Selamat Datang di Studio Foto AI</h2>
                            <p className="text-gray-400 mt-2 max-w-lg mx-auto">Atur parameter di panel kiri dan mulai sesi foto Anda. Hasil akan muncul di sini.</p>
                        </div>
                    </div>
                )}

                {/* Case 3: Image grid is visible (has images, may or may not be loading more) */}
                {generatedImages.length > 0 && (
                    <div className="flex-grow flex flex-col min-h-0">
                        <div className="flex-shrink-0 flex items-center justify-between mb-4">
                            <div>
                                <h2 className="text-xl font-bold text-white">Hasil Sesi Foto</h2>
                                <p className="text-sm text-gray-400">{generatedImages.length} dari {sessionTargetCount} foto dihasilkan.</p>
                            </div>
                           {sessionFinished && !isLoading && (
                                <div className="flex items-center gap-2">
                                     <button onClick={handleClearAll} className="text-sm bg-gray-700 text-white font-semibold py-2 px-4 rounded-md hover:bg-gray-600 transition-colors">Hapus Semua</button>
                                     <button onClick={() => setModals(prev => ({ ...prev, download: true }))} className="text-sm bg-lime-400 text-gray-900 font-bold py-2 px-4 rounded-md hover:bg-lime-500 transition-colors">Unduh Semua</button>
                                </div>
                            )}
                        </div>
                        
                        <div className="flex-grow overflow-y-auto custom-scrollbar -mr-4 pr-4">
                             <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-4">
                                {generatedImages.map(image => (
                                    <div key={image.id} className="relative group aspect-[3/4] cursor-pointer" onClick={() => setModals(prev => ({...prev, lightbox: image.url}))}>
                                        <img src={image.url} alt="Generated prewedding" className="w-full h-full object-cover rounded-xl transition-transform duration-300 group-hover:scale-105" />
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl flex items-center justify-center">
                                            <p className="text-white font-bold">Lihat</p>
                                        </div>
                                    </div>
                                ))}
                                {isLoading && (
                                    <div className="aspect-[3/4] bg-gray-900 rounded-xl flex flex-col items-center justify-center text-center p-4">
                                        <div className="loader mx-auto"></div>
                                        <p className="text-base font-semibold mt-4 text-white">{statusText.split('|')[0]}</p>
                                        <div className="text-xs text-gray-400 mt-2">
                                            <p>{statusText.split('|')[1] || 'AI sedang bekerja...'}</p>
                                            {activeApiKeyMasked && <p>{activeApiKeyMasked}</p>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </main>

            <CommonModals
                modals={modals}
                setModals={setModals}
                isApiModalOpen={isApiModalOpen}
                setIsApiModalOpen={setIsApiModalOpen}
                isAllKeysFailedModalOpen={isAllKeysFailedModalOpen}
                setIsAllKeysFailedModalOpen={setIsAllKeysFailedModalOpen}
                apiKeys={apiKeys}
                apiKeyInput={apiKeyInput}
                setApiKeyInput={setApiKeyInput}
                isKeyValidationLoading={isKeyValidationLoading}
                handleSaveApiKeys={handleSaveApiKeys}
                handleValidateKeys={handleValidateKeys}
                handleRemoveApiKey={handleRemoveApiKey}
                handleDownloadZip={handleDownloadZip}
                handleDownloadSingle={handleDownloadSingle}
                previewData={previewData}
                setPreviewData={setPreviewData}
                handleGenerateCasualPreview={handleGenerateCasualPreview}
                adatPreviewData={adatPreviewData}
                setAdatPreviewData={setAdatPreviewData}
                handleGenerateAdatPreview={handleGenerateAdatPreview}
                handleUseInspiration={handleUseInspiration}
                handleCancelPreviews={handleCancelPreviews}
                activeApiKeyMasked={activeApiKeyMasked}
            />
        </div>
    );
};

export default MainApp;