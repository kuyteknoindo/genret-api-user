import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import saveAs from 'file-saver';
import JSZip from 'jszip';
import { GeneratedImage, ModalState, ReferenceFile, ActiveTab, ApiKey, ApiKeyStatus } from './types';
import { generateImage, generateText, generateConsistentCoupleDescription, generateLocationBasedScenarios, validateApiKey } from './services/geminiService';
import { shuffleArray, generateRandomFilename, cropImageToAspectRatio } from './utils';
import * as D from './creativeData';

const defaultInitialPrompt = `A hyper-realistic, cinematic prewedding photograph of a young Indonesian couple. The woman, wearing a simple pashmina hijab, a long cotton tunic, and a pastel-colored pleated skirt. The man wears a comfortable flannel shirt over a white t-shirt and khaki-colored chino trousers. They are captured in a candid, stolen moment from afar, sharing a quiet moment of shared understanding.`;

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
        })).filter(key => key.value);

    } catch (e) {
        console.error("Failed to parse API keys from storage, clearing it.", e);
        localStorage.removeItem(API_KEY_STORAGE_KEY);
        return [];
    }
};


const storeApiKeys = (keys: ApiKey[]) => {
    localStorage.setItem(API_KEY_STORAGE_KEY, JSON.stringify(keys));
};
// --- End API Key Manager ---

const MainApp: React.FC = () => {
    const [prompt, setPrompt] = useState(defaultInitialPrompt);
    const [referenceFile, setReferenceFile] = useState<ReferenceFile | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [imageCount, setImageCount] = useState(5);
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
    const [userApiKeys, setUserApiKeys] = useState<ApiKey[]>([]);
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [isKeyTutorialOpen, setIsKeyTutorialOpen] = useState(false);
    const [isKeyValidationLoading, setIsKeyValidationLoading] = useState(false);
    const [activeApiKeyMasked, setActiveApiKeyMasked] = useState<string | null>(null);

    const [previewData, setPreviewData] = useState<{ textPrompt: string; imageUrl: string | null; isLoading: boolean; error: string | null } | null>(null);
    const [adatPreviewData, setAdatPreviewData] = useState<{
        region: string;
        textPrompt: string;
        imageUrl: string | null;
        isLoading: boolean;
        status: 'idle' | 'generating_text' | 'generating_image';
        error: string | null;
    } | null>(null);

    const [isEnhancing, setIsEnhancing] = useState(false);
    const [consistentCoupleDescription, setConsistentCoupleDescription] = useState('');
    const [sessionFinished, setSessionFinished] = useState(false);
    
    const isGenerationRunningRef = useRef(false);
    const sessionReferenceImageRef = useRef<ReferenceFile | null>(null);

    useEffect(() => {
        const keys = getStoredApiKeys();
        setUserApiKeys(keys);
        // If no keys are stored, prompt the user to add one on first load.
        if (keys.length === 0) {
            setIsApiModalOpen(true);
        }
    }, []);

    const performApiCall = async <T,>(apiFunction: (apiKey: string) => Promise<T>): Promise<T> => {
        const availableKeys = [
            ...userApiKeys.filter(k => k.status === 'active'),
            ...userApiKeys.filter(k => k.status === 'unvalidated')
        ];

        if (availableKeys.length > 0) {
            for (const keyToTry of availableKeys) {
                try {
                    setActiveApiKeyMasked(keyToTry.masked);
                    const result = await apiFunction(keyToTry.value);
                    
                    if (keyToTry.status === 'unvalidated') {
                        setUserApiKeys(prevKeys => {
                            const newKeys = prevKeys.map(k => 
                                k.id === keyToTry.id ? { ...k, status: 'active' as ApiKeyStatus } : k
                            );
                            storeApiKeys(newKeys);
                            return newKeys;
                        });
                    }
                    
                    return result;
                } catch (error) {
                    const e = error as Error;
                    const errorMessage = e.message || '';

                    if (errorMessage.includes('API key not valid')) {
                        console.warn(`API key ${keyToTry.masked} is invalid.`);
                        setUserApiKeys(prevKeys => {
                            const newKeys = prevKeys.map(k => k.id === keyToTry.id ? { ...k, status: 'invalid' as ApiKeyStatus } : k);
                            storeApiKeys(newKeys);
                            return newKeys;
                        });
                    } else if (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED') || errorMessage.includes('rate limit')) {
                        console.warn(`API key ${keyToTry.masked} is exhausted.`);
                         setUserApiKeys(prevKeys => {
                            const newKeys = prevKeys.map(k => k.id === keyToTry.id ? { ...k, status: 'exhausted' as ApiKeyStatus } : k);
                            storeApiKeys(newKeys);
                            return newKeys;
                        });
                    } else {
                        throw error;
                    }
                }
            }
        }

        // If all user-provided keys have failed or none are available, throw an error.
        setActiveApiKeyMasked(null);
        setIsApiModalOpen(true);
        throw new Error("Tidak ada kunci API yang aktif. Silakan tambahkan kunci API Anda sendiri untuk menggunakan aplikasi ini.");
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
        e.currentTarget.classList.remove('border-blue-500', 'bg-slate-100');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileChange(e.dataTransfer.files[0]);
            e.dataTransfer.clearData();
        }
    }, []);
    
    const generateAutoDescription = async () => {
        setPreviewData({ textPrompt: '', imageUrl: null, isLoading: true, error: null });
        try {
            const randomMaleCloth = D.maleClothing[Math.floor(Math.random() * D.maleClothing.length)];
            const randomMalePants = D.malePants[Math.floor(Math.random() * D.malePants.length)];
            const randomFemaleOption = D.femaleClothingOptions[Math.floor(Math.random() * D.femaleClothingOptions.length)];
            const randomAcc1 = D.accessories[Math.floor(Math.random() * D.accessories.length)];
            
            const femaleDescription = `The female, ${randomFemaleOption.style}, wears ${randomFemaleOption.clothing}${randomFemaleOption.bottom ? ` paired with ${randomFemaleOption.bottom}` : ''}.`;
            const maleDescription = `The male wears ${randomMaleCloth} and ${randomMalePants}.`;
            const accessoryDescription = `They both share a stylish, serene presence, accessorized with items like ${randomAcc1}.`;
            const fullPrompt = `A young Indonesian couple. ${femaleDescription} ${maleDescription} ${accessoryDescription}`;

            setPreviewData({ textPrompt: fullPrompt, imageUrl: null, isLoading: true, error: null });
            
            const imageGenPrompt = `Photorealistic 4k cinematic preview, 3:4 aspect ratio. A young Indonesian couple, their appearance and clothing are described as: "${fullPrompt}". **Must be ethnically Indonesian.** Only one man and one woman. No cartoons.`;
            const imageUrl = await performApiCall(apiKey => generateImage(apiKey, imageGenPrompt, 'gemini-2.5-flash-image-preview'));

            setPreviewData({ textPrompt: fullPrompt, imageUrl, isLoading: false, error: null });

        } catch (error) {
            console.error("Error generating preview:", error);
            const errorMessage = error instanceof Error ? error.message : "Terjadi kesalahan";
            setPreviewData(prev => ({ ...(prev ?? { textPrompt: '', imageUrl: null, isLoading: false, error: null }), isLoading: false, error: `Gagal membuat preview: ${errorMessage}` }));
        } finally {
            setActiveApiKeyMasked(null);
        }
    };

    const handleGenerateAdatPreview = async () => {
        if (!adatPreviewData?.region) {
            setAdatPreviewData(prev => ({ ...(prev!), error: "Harap masukkan daerah asal pakaian adat." }));
            return;
        }
        
        const region = adatPreviewData.region;
        setAdatPreviewData(prev => ({ ...(prev!), imageUrl: null, textPrompt: '', isLoading: true, status: 'generating_text', error: null }));

        try {
            const textGenPrompt = `Create a concise, culturally rich English description for an AI photo prompt. Subject: A couple in complete traditional wedding attire from the ${region} region of Indonesia. Focus on key visual elements: specific garment names, patterns (batik, songket), and accessories (blangkon, sanggul).`;
            const generatedText = await performApiCall(apiKey => generateText(apiKey, textGenPrompt));

            setAdatPreviewData(prev => ({ ...(prev!), textPrompt: generatedText, status: 'generating_image' }));
            
            const imageGenPrompt = `Photorealistic 4k cinematic preview, 3:4 aspect ratio. Description: "${generatedText}". **CRITICAL: The couple must be ethnically Indonesian, with features authentic to the ${region} region.** Culturally accurate attire. No cartoons.`;
            const imageUrl = await performApiCall(apiKey => generateImage(apiKey, imageGenPrompt, 'gemini-2.5-flash-image-preview'));

            setAdatPreviewData(prev => ({ ...(prev!), imageUrl, isLoading: false, status: 'idle' }));

        } catch (error) {
             console.error("Error generating adat preview:", error);
            const errorMessage = error instanceof Error ? error.message : "Terjadi kesalahan";
            setAdatPreviewData(prev => ({ ...(prev!), isLoading: false, status: 'idle', error: `Gagal membuat preview: ${errorMessage}` }));
        } finally {
            setActiveApiKeyMasked(null);
        }
    };

    const handleEnhancePrompt = async () => {
        if (!prompt) {
            setModals(prev => ({...prev, error: "Tulis deskripsi terlebih dahulu untuk ditingkatkan."}));
            return;
        }
        setIsEnhancing(true);
        try {
            const enhancementInstruction = `Enhance this user's description into a rich, detailed, and evocative prompt for an AI pre-wedding photo generator. Add cinematic lighting, emotional cues, and artistic composition, focusing on Indonesian cultural context. Output a single, cohesive paragraph. User description: "${prompt}"`;
            const enhancedPrompt = await performApiCall(apiKey => generateText(apiKey, enhancementInstruction));
            setPrompt(enhancedPrompt);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Terjadi kesalahan";
            setModals(prev => ({...prev, error: `Gagal meningkatkan prompt: ${errorMessage}`}));
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

    const runGeneration = async (isContinuation = false) => {
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
    
        if (!isContinuation) {
            setGeneratedImages([]);
            setSessionFinished(false);
            sessionReferenceImageRef.current = null; // Reset for new session
        }
    
        let baseDescription = consistentCoupleDescription || prompt;
        let scenarios: { scene: string; emotion: string }[] = [];
    
        try {
            // Step 1: Create consistent description if starting from text prompt
            if (!isContinuation && activeTab === 'prompt' && prompt) {
                setStatusText('Membuat deskripsi pasangan yang konsisten...');
                const coupleDesc = await performApiCall(apiKey => generateConsistentCoupleDescription(apiKey, prompt));
                setConsistentCoupleDescription(coupleDesc);
                baseDescription = coupleDesc;
            } else if (isReferenceTabActive) {
                setConsistentCoupleDescription('');
            }
    
            // Step 2: Generate all creative scenarios at once, with fallback
            setStatusText(`Membuat skenario kreatif untuk ${locationTheme}...`);
            try {
                scenarios = await performApiCall(apiKey => generateLocationBasedScenarios(apiKey, locationTheme, imageCount));
            } catch (error) {
                 console.warn("Creative scenario generation failed. Falling back to generic scenarios.", error);
                 setStatusText(`Skenario kreatif gagal, menggunakan skenario cadangan...`);
                 scenarios = shuffleArray<string>(D.storyScenes)
                     .slice(0, imageCount)
                     .map(scene => ({
                         scene,
                         emotion: shuffleArray<string>(D.emotionalCues)[0]
                     }));
            }

            if (scenarios.length < imageCount) {
                const fallback = { scene: 'The couple shares a quiet, intimate moment.', emotion: 'A feeling of deep connection.' };
                scenarios.push(...Array(imageCount - scenarios.length).fill(fallback));
            }
            
            setStatusText(`Persiapan selesai. Memulai sesi foto...`);
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Step 3: Loop through and generate images
            const startIndex = isContinuation ? generatedImages.length : 0;
            const targetCount = startIndex + imageCount;
    
            for (let i = startIndex; i < targetCount; i++) {
                if (!isGenerationRunningRef.current) break;
    
                const scenarioIndex = i - startIndex;
                const scenario = scenarios[scenarioIndex % scenarios.length];
                const photoStyle = shuffleArray(D.photographicStyles)[0];
                const negativePrompt = [
                    ...Array.from(selectedNegativePrompts),
                    ...customNegativePrompt.split(',').map(s => s.trim()).filter(Boolean)
                ].join(', ');
                
                setStatusText(`Gambar ${i + 1}/${targetCount} | ${scenario.scene.substring(0, 50)}...`);
    
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
                    imageUrl = await performApiCall(apiKey => generateImage(apiKey, finalPrompt, imageModel, currentReference.base64, currentReference.mimeType));
                } else {
                     finalPrompt = `Photorealistic 4k cinematic prewedding photo of a young **Indonesian couple with authentic Southeast Asian features.**
- **Appearance (Strictly follow):** "${baseDescription}"
- **Location:** ${locationTheme}
- **Scene:** ${scenario.scene}
- **Emotion:** ${scenario.emotion}
- **Style:** ${photoStyle}
- **Negative Prompts:** ${negativePrompt || 'None'}`;
                    
                    imageUrl = await performApiCall(apiKey => generateImage(apiKey, finalPrompt, imageModel));
    
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
            setModals(prev => ({ ...prev, error: `Sesi foto gagal: ${e.message}` }));
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
    
    const handleSaveApiKeys = () => {
        const keys = apiKeyInput.split('\n').map(k => k.trim()).filter(Boolean);
        const newApiKeys: ApiKey[] = keys.map(k => {
            const existing = userApiKeys.find(ak => ak.value === k);
            if (existing) return existing;
            return {
                id: `key_${Date.now()}_${Math.random()}`,
                value: k,
                masked: `${k.slice(0, 4)}...${k.slice(-4)}`,
                status: 'unvalidated'
            };
        });
        
        const updatedKeys = userApiKeys
          .filter(oldKey => keys.includes(oldKey.value)) // Keep old keys that are still in the input
          .concat(newApiKeys.filter(newKey => !userApiKeys.some(oldKey => oldKey.value === newKey.value))); // Add new keys

        const finalKeys = keys.map(k => updatedKeys.find(uk => uk.value === k)).filter(Boolean) as ApiKey[];


        setUserApiKeys(finalKeys);
        storeApiKeys(finalKeys);
        setApiKeyInput('');
    };

    const handleValidateKeys = async () => {
        if (isKeyValidationLoading || userApiKeys.length === 0) return;
        setIsKeyValidationLoading(true);
    
        const newKeys = [...userApiKeys];
        for (let i = 0; i < newKeys.length; i++) {
            const key = newKeys[i];
            const status = await validateApiKey(key.value);
            newKeys[i] = { ...key, status };
            setUserApiKeys([...newKeys]);
        }
        
        storeApiKeys(newKeys);
        setIsKeyValidationLoading(false);
    };

    const handleRemoveApiKey = (idToRemove: string) => {
        const newKeys = userApiKeys.filter(k => k.id !== idToRemove);
        setUserApiKeys(newKeys);
        storeApiKeys(newKeys);
    };

    const getStatusIndicator = (status: ApiKeyStatus) => {
        switch(status) {
            case 'active': return <span className="w-3 h-3 bg-green-500 rounded-full" title="Active"></span>;
            case 'invalid': return <span className="w-3 h-3 bg-red-500 rounded-full" title="Invalid/Error"></span>;
            case 'exhausted': return <span className="w-3 h-3 bg-red-500 rounded-full" title="Limit Reached"></span>;
            case 'unvalidated': return <span className="w-3 h-3 bg-slate-400 rounded-full" title="Unvalidated"></span>;
        }
    };
    

    return (
        <div className="min-h-screen bg-slate-100 p-4 lg:p-6 flex flex-col lg:flex-row gap-6 relative">
            {/* Control Panel Card */}
            <aside className="w-full lg:w-1/3 xl:w-[380px] bg-white p-6 rounded-xl shadow-lg custom-scrollbar overflow-y-auto flex flex-col">
                <div className="sticky top-0 bg-white py-4 z-10 flex justify-between items-center -mx-6 px-6 border-b border-slate-200">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900">AI Photographer</h1>
                        <p className="text-sm text-slate-500 mt-1">Prewedding Edition</p>
                    </div>
                     <button onClick={() => setIsApiModalOpen(true)} className="p-2 rounded-full hover:bg-slate-100 transition-colors" title="Kelola API Key">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>
                    </button>
                </div>

                <div className="flex border-b border-slate-200 mt-6">
                    <button
                        onClick={() => setActiveTab('prompt')}
                        className={`flex-1 pb-3 px-1 text-sm font-semibold transition-colors focus:outline-none ${activeTab === 'prompt' ? 'border-b-2 border-blue-600 text-blue-600' : 'border-b-2 border-transparent text-slate-500 hover:text-slate-800'}`}
                    >
                        Teks Prompt
                    </button>
                    <button
                        onClick={() => setActiveTab('reference')}
                        disabled={imageModel === 'imagen-4.0-generate-001'}
                        className={`flex-1 pb-3 px-1 text-sm font-semibold transition-colors focus:outline-none ${activeTab === 'reference' ? 'border-b-2 border-blue-600 text-blue-600' : 'border-b-2 border-transparent text-slate-500'} ${imageModel === 'imagen-4.0-generate-001' ? 'cursor-not-allowed opacity-50' : 'hover:text-slate-800'}`}
                        title={imageModel === 'imagen-4.0-generate-001' ? 'Model Imagen tidak mendukung gambar referensi' : ''}
                    >
                        Prompt + Referensi
                    </button>
                </div>
                
                <div className="mt-8 space-y-6">
                    {activeTab === 'prompt' && (
                        <div>
                             <div className="relative">
                                <label htmlFor="prompt" className="block text-sm font-medium text-slate-700 mb-2">1. Deskripsi Pasangan & Pakaian</label>
                                <textarea id="prompt" rows={8} value={prompt} onChange={e => setPrompt(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-sm focus:ring-blue-500 focus:border-blue-500 placeholder-slate-400" placeholder="Tulis deskripsi singkat dan klik 'Tingkatkan', atau tulis deskripsi detail Anda sendiri..."></textarea>
                                <div className="absolute bottom-3 right-3 flex gap-2">
                                     <button onClick={handleEnhancePrompt} disabled={isEnhancing} className="text-xs bg-purple-100 text-purple-800 font-semibold py-1 px-2 rounded-md hover:bg-purple-200 disabled:opacity-50 disabled:cursor-wait">
                                        {isEnhancing ? 'Meningkatkan...' : '✨ Tingkatkan'}
                                    </button>
                                     <button onClick={() => setAdatPreviewData({ region: '', textPrompt: '', imageUrl: null, isLoading: false, status: 'idle', error: null })} className="text-xs bg-blue-100 text-blue-800 font-semibold py-1 px-2 rounded-md hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed">
                                        Pakaian Adat
                                    </button>
                                    <button onClick={generateAutoDescription} className="text-xs bg-blue-100 text-blue-700 font-semibold py-1 px-2 rounded-md hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed">
                                        ✨ Pakaian Casual
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'reference' && (
                        <>
                         <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">1. Unggah Foto Referensi <span className="text-slate-400 font-normal">(Wajib)</span></label>
                            <div 
                                id="drop-zone" 
                                onDrop={handleDrop} 
                                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-blue-500', 'bg-slate-100'); }}
                                onDragLeave={e => e.currentTarget.classList.remove('border-blue-500', 'bg-slate-100')}
                                onClick={() => document.getElementById('file-input')?.click()}
                                className="flex justify-center items-center w-full h-40 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors"
                            >
                                {!imagePreview ? (
                                    <div id="drop-zone-text" className="text-center text-slate-500">
                                        <svg className="mx-auto h-10 w-10 text-slate-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                                        <p className="mt-2 text-sm">Drag & drop atau klik</p>
                                    </div>
                                ) : (
                                    <img id="image-preview" src={imagePreview} className="h-full w-full object-contain rounded-lg p-2" alt="Image Preview" />
                                )}
                                <input type="file" id="file-input" onChange={e => handleFileChange(e.target.files?.[0] ?? null)} className="hidden" accept="image/*"/>
                            </div>
                             <p className="text-xs text-slate-500 mt-2">
                                Mode ini disarankan untuk hasil lebih baik & menghindari batas kuota harian.
                            </p>
                        </div>
                        <div>
                            <label htmlFor="prompt-ref" className="block text-sm font-medium text-slate-700 mb-2">2. Panduan Tambahan <span className="text-slate-400 font-normal">(Opsional)</span></label>
                            <textarea id="prompt-ref" rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-sm focus:ring-blue-500 focus:border-blue-500 placeholder-slate-400" placeholder="Misal: ubah pakaian menjadi gaun pengantin..."></textarea>
                        </div>
                        </>
                    )}

                     <div>
                        <label htmlFor="model-select" className="block text-sm font-medium text-slate-700 mb-2">2. Pilih Model AI</label>
                        <select 
                            id="model-select" 
                            value={imageModel} 
                            onChange={e => {
                                const newModel = e.target.value;
                                setImageModel(newModel);
                                if (newModel === 'imagen-4.0-generate-001' && activeTab === 'reference') {
                                    setActiveTab('prompt');
                                }
                            }} 
                            className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-sm focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="gemini-2.5-flash-image-preview">Gemini Flash (Cepat & Fleksibel)</option>
                            <option value="imagen-4.0-generate-001">Imagen 4 (Kualitas Tertinggi)</option>
                        </select>
                        {imageModel === 'imagen-4.0-generate-001' && (
                            <p className="text-xs text-amber-600 mt-2">
                                Model Imagen tidak mendukung gambar referensi. Tab "Prompt + Referensi" dinonaktifkan.
                            </p>
                        )}
                    </div>
                    
                    <div>
                        <label htmlFor="location-theme" className="block text-sm font-medium text-slate-700 mb-2">3. Pilih Tema Sesi Foto</label>
                        <select id="location-theme" value={locationTheme} onChange={e => setLocationTheme(e.target.value)} className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-sm focus:ring-blue-500 focus:border-blue-500">
                            {Object.entries(locationGroups).map(([group, themes]) => (
                                <optgroup key={group} label={group}>
                                    {themes.map(theme => (
                                        <option key={theme} value={theme}>
                                            {["Kehidupan Sehari-hari", "Kisah Kampus", "Studio Foto Profesional"].includes(theme)
                                                ? theme
                                                : `Sesi Foto di ${theme}`}
                                        </option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">4. Hindari Elemen (Negative Prompt)</label>
                        <div className="bg-slate-50 border border-slate-300 rounded-lg p-3 space-y-3">
                            <div>
                                <span className="text-xs text-slate-600 font-medium">Pilih dari opsi umum:</span>
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {D.negativePromptOptions.map(tag => (
                                        <span 
                                            key={tag} 
                                            className={`negative-tag ${selectedNegativePrompts.has(tag) ? 'selected' : ''}`} 
                                            onClick={() => toggleNegativePrompt(tag)}
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label htmlFor="custom-negative-prompt" className="text-xs text-slate-600 font-medium">Atau tulis sendiri (pisahkan dengan koma):</label>
                                <input
                                    type="text"
                                    id="custom-negative-prompt"
                                    value={customNegativePrompt}
                                    onChange={e => setCustomNegativePrompt(e.target.value)}
                                    className="w-full bg-white border border-slate-300 rounded-md p-2 text-sm focus:ring-blue-500 focus:border-blue-500 placeholder-slate-400 mt-1"
                                    placeholder="e.g., blurry, text, extra people"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="image-count" className="block text-sm font-medium text-slate-700 mb-2">
                                {sessionFinished && generatedImages.length > 0 ? 'Tambah Foto' : '5. Jumlah Foto'}
                            </label>
                            <input type="number" id="image-count" value={imageCount} onChange={e => setImageCount(parseInt(e.target.value))} min="1" max="10" className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label htmlFor="delay" className="block text-sm font-medium text-slate-700 mb-2">Jeda (detik)</label>
                            <input type="number" id="delay" value={delay} onChange={e => setDelay(parseInt(e.target.value))} min="0" max="30" className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-sm focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                    </div>
                    
                    <div className="mt-6">
                    {isLoading ? (
                        <button 
                            onClick={handleStop}
                            className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center shadow-sm"
                        >
                            <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"></path></svg>
                            Hentikan Proses
                        </button>
                    ) : sessionFinished && generatedImages.length > 0 ? (
                        <div className="flex flex-col gap-3">
                             <button onClick={() => runGeneration(true)} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center shadow-sm">
                               <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                                Lanjutkan Generate
                            </button>
                             <button onClick={() => runGeneration(false)} className="w-full bg-slate-600 hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center justify-center shadow-sm text-sm">
                               <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M4 4v5h5M20 20v-5h-5M4 20h5v-5M20 4h-5v5"></path></svg>
                                Mulai Sesi Baru
                            </button>
                        </div>
                    ) : (
                        <button id="generate-btn" onClick={() => runGeneration(false)} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center shadow-sm">
                            <svg className="w-5 h-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.898 20.562L16.25 22.5l-.648-1.938a3.375 3.375 0 00-2.684-2.684l-1.938-.648 1.938-.648a3.375 3.375 0 002.684-2.684l.648-1.938.648 1.938a3.375 3.375 0 002.684 2.684l1.938.648-1.938.648a3.375 3.375 0 00-2.684 2.684z" /></svg>
                            Mulai Sesi Foto
                        </button>
                    )}
                    </div>
                </div>
            </aside>

            {/* Image Gallery Card */}
            <main className="w-full lg:flex-1 flex flex-col min-h-0">
                <div className="bg-white rounded-xl shadow-lg p-6 flex-grow flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="flex-shrink-0 flex flex-col sm:flex-row justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold text-slate-900">Hasil Sesi Foto</h2>
                        <div className="flex space-x-2 mt-4 sm:mt-0">
                            <button onClick={() => setModals(p => ({...p, download: true}))} disabled={generatedImages.length === 0} className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors flex items-center shadow-sm disabled:bg-green-400 disabled:cursor-not-allowed">
                                <svg className="w-4 h-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                                Download All
                            </button>
                            <button onClick={() => { setGeneratedImages([]); setSessionFinished(false); }} disabled={generatedImages.length === 0} className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors flex items-center shadow-sm disabled:bg-red-400 disabled:cursor-not-allowed">
                                <svg className="w-4 h-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.134-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.067-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                                Clear All
                            </button>
                        </div>
                    </div>

                    {/* Scrolling Content */}
                    <div className="flex-grow overflow-y-auto custom-scrollbar -mx-2 px-2">
                        {isLoading && (
                            <div id="status-container" className="flex flex-col items-center justify-center py-8">
                                <div className="loader mx-auto"></div>
                                <p id="status-text" className="mt-4 text-slate-600">{statusText}</p>
                                {activeApiKeyMasked && (
                                    <p className="mt-2 text-xs text-slate-500 bg-slate-200 px-2 py-1 rounded-md">
                                        Menggunakan kunci: <span className="font-mono">{activeApiKeyMasked}</span>
                                    </p>
                                )}
                            </div>
                        )}
                        
                        {generatedImages.length > 0 ? (
                            <div id="gallery" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {generatedImages.map((image) => (
                                    <div key={image.id} className="group relative bg-slate-200 rounded-lg overflow-hidden shadow-md">
                                        <img src={image.url} alt="Generated Prewedding Photo" className="w-full h-full object-cover aspect-[3/4] cursor-pointer" onClick={() => setModals(p => ({...p, lightbox: image.url}))} />
                                        <div className="image-card-overlay">
                                            <button onClick={() => saveAs(image.url, generateRandomFilename())} className="p-2 bg-black bg-opacity-50 rounded-full text-white hover:bg-opacity-75 transition-all" aria-label="Download Image">
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                            </button>
                                            <button onClick={() => setGeneratedImages(imgs => imgs.filter(i => i.id !== image.id))} className="p-2 bg-black bg-opacity-50 rounded-full text-white hover:bg-opacity-75 transition-all" aria-label="Delete Image">
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : !isLoading && (
                            <div id="welcome-message" className="flex flex-col items-center justify-center h-full text-center text-slate-400">
                                <svg className="mx-auto h-16 w-16" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor"><path strokeLinecap="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.776 48.776 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /><path strokeLinecap="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" /></svg>
                                <p className="mt-4 text-lg">Hasil foto Anda akan muncul di sini.</p>
                                <p className="text-sm">Atur sesi foto Anda dan biarkan AI bekerja.</p>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {/* Modals */}
            {isApiModalOpen && (
                 <div className="modal-backdrop show">
                    <div className="modal-content w-full max-w-2xl">
                         <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-slate-900">Kelola API Key Gemini</h3>
                            <button onClick={() => setIsApiModalOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="Tutup">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label htmlFor="api-key-input" className="block text-sm font-medium text-slate-700 mb-2">Masukkan API Key Anda</label>
                                <textarea
                                    id="api-key-input"
                                    rows={5}
                                    value={apiKeyInput}
                                    onChange={e => setApiKeyInput(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-sm focus:ring-blue-500 focus:border-blue-500 placeholder-slate-400"
                                    placeholder="Masukkan satu atau lebih API key, pisahkan dengan baris baru..."
                                ></textarea>
                                <div className="flex gap-2 mt-2">
                                    <button onClick={handleSaveApiKeys} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm">Simpan Kunci</button>
                                    <button 
                                        onClick={handleValidateKeys} 
                                        disabled={isKeyValidationLoading || userApiKeys.length === 0}
                                        className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold py-2 px-4 rounded-lg text-sm disabled:opacity-50 disabled:cursor-wait flex items-center justify-center gap-2 transition-colors"
                                    >
                                        {isKeyValidationLoading && <span className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin"></span>}
                                        {isKeyValidationLoading ? 'Memvalidasi...' : 'Validasi Kunci'}
                                    </button>
                                </div>
                            </div>
                            <div>
                                <h4 className="text-sm font-medium text-slate-700 mb-2">Kunci Tersimpan</h4>
                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 h-40 overflow-y-auto custom-scrollbar">
                                    {userApiKeys.length > 0 ? (
                                        <ul className="space-y-2">
                                            {userApiKeys.map(key => (
                                                <li key={key.id} className="flex items-center justify-between text-sm">
                                                    <div className="flex items-center gap-2">
                                                        {getStatusIndicator(key.status)}
                                                        <span className="font-mono text-slate-600">{key.masked}</span>
                                                    </div>
                                                    <button onClick={() => handleRemoveApiKey(key.id)} className="text-red-500 hover:text-red-700 p-1" aria-label={`Hapus kunci ${key.masked}`}>
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-xs text-slate-500 text-center pt-10">Tidak ada API key disimpan. Anda harus menambahkan kunci untuk menggunakan aplikasi.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 border-t border-slate-200 pt-4">
                            <button onClick={() => setIsKeyTutorialOpen(p => !p)} className="text-sm font-medium text-slate-700 flex items-center w-full justify-between">
                                Cara Mendapatkan API Key
                                <svg className={`w-5 h-5 transition-transform ${isKeyTutorialOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </button>
                            {isKeyTutorialOpen && (
                                <div className="mt-3 text-xs text-slate-600 space-y-2 prose">
                                    <ol className="list-decimal list-inside">
                                        <li>Buka <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Google AI Studio</a>.</li>
                                        <li>Klik tombol <strong>"Create API key in new project"</strong>.</li>
                                        <li>Salin (copy) API key yang muncul.</li>
                                        <li>Tempel (paste) kunci tersebut ke dalam kolom di atas dan simpan.</li>
                                        <li>Penting: Untuk performa terbaik, aktifkan penagihan (Billing) di project Google Cloud Anda. Anda tetap mendapatkan kuota gratis yang besar.</li>
                                    </ol>
                                </div>
                            )}
                        </div>
                    </div>
                 </div>
            )}
            {adatPreviewData && (
                 <div className="modal-backdrop show">
                    <div className="modal-content w-full max-w-4xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-slate-900">Preview Pakaian Adat</h3>
                            <button onClick={() => setAdatPreviewData(null)} className="text-slate-400 hover:text-slate-600" aria-label="Tutup pratinjau">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>

                        <div className="flex flex-col md:flex-row gap-6">
                            {/* Left Column */}
                            <div className="md:w-1/2 flex flex-col">
                                <div className="mb-4">
                                    <label htmlFor="adat-region" className="block text-sm font-medium text-slate-700 mb-2">Pakaian adat mana yang akan dibuat?</label>
                                    <div className="flex gap-2">
                                        <input 
                                            type="text" 
                                            id="adat-region"
                                            value={adatPreviewData.region}
                                            onChange={e => setAdatPreviewData(prev => ({...(prev!), region: e.target.value}))}
                                            className="w-full bg-slate-50 border border-slate-300 rounded-lg p-3 text-sm focus:ring-blue-500 focus:border-blue-500 placeholder-slate-400"
                                            placeholder="Contoh: Jawa, Bali, Minang..." 
                                            disabled={adatPreviewData.isLoading}
                                        />
                                        <button onClick={handleGenerateAdatPreview} disabled={adatPreviewData.isLoading || !adatPreviewData.region} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-wait">
                                            Buat
                                        </button>
                                    </div>
                                </div>
                                
                                <h4 className="text-sm font-semibold text-slate-800 mb-2">Deskripsi Dihasilkan</h4>
                                <div className="flex-grow bg-slate-50 p-3 rounded-lg border border-slate-200 overflow-y-auto text-xs text-slate-600 min-h-[150px]">
                                    {adatPreviewData.textPrompt || 'Deskripsi akan dibuat di sini setelah Anda memasukkan daerah dan klik "Buat".'}
                                </div>

                                <div className="mt-6 flex gap-3">
                                    <button onClick={() => {
                                        if (adatPreviewData.imageUrl && adatPreviewData.textPrompt) {
                                            const [header, base64] = adatPreviewData.imageUrl.split(',');
                                            const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
                                            setReferenceFile({ base64, mimeType });
                                            setImagePreview(adatPreviewData.imageUrl);
                                            setPrompt(adatPreviewData.textPrompt);
                                            setActiveTab('reference');
                                            setAdatPreviewData(null);
                                        }
                                    }} disabled={!adatPreviewData.imageUrl || adatPreviewData.isLoading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg disabled:bg-blue-400 disabled:cursor-not-allowed">
                                        Gunakan
                                    </button>
                                </div>
                            </div>
                             {/* Right Column */}
                            <div className="md:w-1/2">
                                 {adatPreviewData.isLoading ? (
                                    <div className="flex flex-col items-center justify-center h-full w-full aspect-[3/4] bg-slate-50 rounded-lg">
                                        <div className="loader"></div>
                                        <p className="mt-4 text-slate-600 text-center text-sm px-4">
                                            {adatPreviewData.status === 'generating_text'
                                                ? `Membuat deskripsi untuk pakaian adat ${adatPreviewData.region}...`
                                                : 'Menggunakan deskripsi untuk membuat preview gambar...'}
                                        </p>
                                        {activeApiKeyMasked && (
                                            <p className="mt-2 text-xs text-slate-500 bg-slate-200 px-2 py-1 rounded-md">
                                                Menggunakan kunci: <span className="font-mono">{activeApiKeyMasked}</span>
                                            </p>
                                        )}
                                    </div>
                                ) : adatPreviewData.imageUrl ? (
                                    <div className="w-full aspect-[3/4] bg-slate-200 rounded-lg overflow-hidden">
                                        <img src={adatPreviewData.imageUrl} alt="Preview Pakaian Adat" className="w-full h-full object-cover"/>
                                    </div>
                                ) : adatPreviewData.error ? (
                                    <div className="flex flex-col items-center justify-center h-full w-full aspect-[3/4] bg-red-50 text-red-700 rounded-lg p-4 text-center">
                                       <p className="font-semibold">Oops! Gagal membuat preview.</p>
                                       <p className="text-sm mt-2">{adatPreviewData.error}</p>
                                    </div>
                                ) : (
                                     <div className="flex flex-col items-center justify-center h-full w-full aspect-[3/4] bg-slate-50 rounded-lg">
                                        <p className="text-slate-500">Preview akan muncul di sini.</p>
                                     </div>
                                )}
                            </div>
                        </div>
                    </div>
                 </div>
            )}
             {previewData && (
                <div className="modal-backdrop show">
                    <div className="modal-content w-full max-w-4xl">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-slate-900">✨ Preview Pakaian Casual</h3>
                            <button onClick={() => setPreviewData(null)} className="text-slate-400 hover:text-slate-600" aria-label="Tutup pratinjau">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        <div className="flex flex-col md:flex-row gap-6">
                             {/* Left Column */}
                             <div className="md:w-1/2 flex flex-col">
                                <h4 className="text-base font-semibold text-slate-800 mb-2">Deskripsi yang Dihasilkan</h4>
                                <div className="flex-grow bg-slate-50 p-3 rounded-lg border border-slate-200 overflow-y-auto text-xs text-slate-600 min-h-[150px]">
                                    <p>{previewData.textPrompt || 'Menunggu deskripsi...'}</p>
                                </div>
                                <div className="mt-6 flex flex-col sm:flex-row gap-3">
                                    <button onClick={generateAutoDescription} disabled={previewData.isLoading} className="w-full sm:w-auto flex-1 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-wait">
                                        Buat Ulang
                                    </button>
                                    <button onClick={() => {
                                        if (previewData.imageUrl && previewData.textPrompt) {
                                            const [header, base64] = previewData.imageUrl.split(',');
                                            const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
                                            setReferenceFile({ base64, mimeType });
                                            setImagePreview(previewData.imageUrl);
                                            setPrompt(''); // Clear prompt as it's now visual
                                            setActiveTab('reference');
                                            setPreviewData(null);
                                        }
                                    }} disabled={!previewData.imageUrl || previewData.isLoading} className="w-full sm:w-auto flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg disabled:bg-blue-400 disabled:cursor-not-allowed">
                                        Gunakan
                                    </button>
                                </div>
                             </div>
                             {/* Right Column */}
                             <div className="md:w-1/2">
                                {previewData.isLoading ? (
                                    <div className="flex flex-col items-center justify-center h-full w-full aspect-[3/4] bg-slate-50 rounded-lg">
                                        <div className="loader"></div>
                                        <p className="mt-4 text-slate-600">Membuat preview gambar...</p>
                                        {activeApiKeyMasked && (
                                            <p className="mt-2 text-xs text-slate-500 bg-slate-200 px-2 py-1 rounded-md">
                                                Menggunakan kunci: <span className="font-mono">{activeApiKeyMasked}</span>
                                            </p>
                                        )}
                                    </div>
                                ) : previewData.imageUrl ? (
                                    <div className="w-full aspect-[3/4] bg-slate-200 rounded-lg overflow-hidden">
                                        <img src={previewData.imageUrl} alt="Preview" className="w-full h-full object-cover"/>
                                    </div>
                                ) : previewData.error ? (
                                    <div className="flex flex-col items-center justify-center h-full w-full aspect-[3/4] bg-red-50 text-red-700 rounded-lg p-4 text-center">
                                    <p className="font-semibold">Oops! Gagal membuat preview.</p>
                                    <p className="text-sm mt-2">{previewData.error}</p>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {modals.error && (
                <div id="error-modal" className="modal-backdrop show">
                    <div className="modal-content w-full max-w-sm">
                        <h3 className="text-lg font-bold text-red-600">Error</h3>
                        <p id="error-message" className="text-slate-700 mt-2">{modals.error}</p>
                        <button onClick={() => setModals(p => ({...p, error: null}))} className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">Tutup</button>
                    </div>
                </div>
            )}
            {modals.lightbox && (
                <div id="lightbox" className="modal-backdrop show" onClick={() => setModals(p => ({...p, lightbox: null}))}>
                    <button id="lightbox-close-btn" className="close-lightbox" type="button" aria-label="Tutup lightbox">
                        <svg width="20" height="20" viewBox="0 0 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    </button>
                    <img id="lightbox-image" src={modals.lightbox} alt="Enlarged view" onClick={e => e.stopPropagation()} />
                </div>
            )}
             {modals.download && (
                <div id="download-modal" className="modal-backdrop show">
                  <div className="modal-content w-full max-w-md">
                    <h3 className="text-lg font-bold text-slate-900">Pilih Format Download</h3>
                    <p className="text-slate-600 text-sm mt-2">Pilih aspek rasio untuk file ZIP Anda.</p>
                    <div className="mt-6 grid grid-cols-1 gap-3">
                      <button onClick={() => handleDownloadZip(3/5)} className="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-3 px-4 rounded-lg">Original (3:5)</button>
                      <button onClick={() => handleDownloadZip(3/4)} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg">Portrait (3:4)</button>
                      <button onClick={() => handleDownloadZip(3/2)} className="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-3 px-4 rounded-lg">Landscape (3:2)</button>
                    </div>
                    <button onClick={() => setModals(p => ({...p, download: false}))} className="mt-4 w-full text-sm text-slate-500 hover:text-slate-700">Batal</button>
                  </div>
                </div>
             )}
        </div>
    );
};

export default MainApp;