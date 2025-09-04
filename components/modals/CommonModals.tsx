import React from 'react';
import { ModalState, ApiKey, ApiKeyStatus } from '../../types';
import { adatInspirations } from '../../creativeData';

type PreviewData = {
    textPrompt: string;
    imageUrl: string | null;
    isLoading: boolean;
    error: string | null;
    statusText: string;
} | null;

type AdatPreviewData = {
    region: string;
    textPrompt: string;
    imageUrl: string | null;
    isLoading: boolean;
    error: string | null;
    statusText: string;
} | null;

type ManualPreviewData = {
    textPrompt: string;
    imageUrl: string | null;
    isLoading: boolean;
    error: string | null;
    statusText: string;
} | null;

interface CommonModalsProps {
    modals: ModalState;
    setModals: React.Dispatch<React.SetStateAction<ModalState>>;
    isApiModalOpen: boolean;
    setIsApiModalOpen: (isOpen: boolean) => void;
    isAllKeysFailedModalOpen: boolean;
    setIsAllKeysFailedModalOpen: (isOpen: boolean) => void;
    apiKeys: ApiKey[];
    apiKeyInput: string;
    setApiKeyInput: React.Dispatch<React.SetStateAction<string>>;
    isKeyValidationLoading: boolean;
    handleSaveApiKeys: () => void;
    handleValidateKeys: () => Promise<void>;
    handleRemoveApiKey: (id: string) => void;
    handleDownloadZip: (aspectRatio?: number) => Promise<void>;
    handleDownloadSingle: (url: string) => void;
    previewData: PreviewData;
    setPreviewData: React.Dispatch<React.SetStateAction<PreviewData>>;
    handleGenerateCasualPreview: () => Promise<void>;
    adatPreviewData: AdatPreviewData;
    setAdatPreviewData: React.Dispatch<React.SetStateAction<AdatPreviewData>>;
    handleGenerateAdatPreview: () => Promise<void>;
    manualPreviewData: ManualPreviewData;
    setManualPreviewData: React.Dispatch<React.SetStateAction<ManualPreviewData>>;
    handleGenerateManualPreview: () => Promise<void>;
    handleUseInspiration: (text: string, imageUrl: string) => void;
    handleCancelPreviews: () => void;
    activeApiKeyMasked: string | null;
}

const ApiKeyStatusIndicator: React.FC<{ status: ApiKeyStatus }> = ({ status }) => {
    const statusMap = {
        active: { text: 'Aktif', color: 'bg-green-500' },
        invalid: { text: 'Tidak Valid', color: 'bg-red-500' },
        exhausted: { text: 'Kuota Habis', color: 'bg-yellow-500' },
        unvalidated: { text: 'Belum Divalidasi', color: 'bg-gray-500' },
    };
    const { text, color } = statusMap[status];
    return (
        <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${color}`}></span>
            <span className="text-xs text-gray-300">{text}</span>
        </div>
    );
};

const CommonModals: React.FC<CommonModalsProps> = ({
    modals, setModals, isApiModalOpen, setIsApiModalOpen, isAllKeysFailedModalOpen, setIsAllKeysFailedModalOpen,
    apiKeys, apiKeyInput, setApiKeyInput, isKeyValidationLoading, handleSaveApiKeys, handleValidateKeys, 
    handleRemoveApiKey, handleDownloadZip, handleDownloadSingle, previewData, setPreviewData, 
    handleGenerateCasualPreview, adatPreviewData, setAdatPreviewData, handleGenerateAdatPreview, 
    manualPreviewData, setManualPreviewData, handleGenerateManualPreview, handleUseInspiration,
    handleCancelPreviews, activeApiKeyMasked
}) => {
    const closeModal = () => setModals({ error: null, download: false, lightbox: null });

    return (
        <>
            {/* Error Modal */}
            {modals.error && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal-content w-full max-w-md text-center" onClick={e => e.stopPropagation()}>
                        <h3 className="text-xl font-bold text-red-400 mb-4">Terjadi Kesalahan</h3>
                        <p className="text-gray-300 mb-6">{modals.error}</p>
                        <button onClick={closeModal} className="bg-lime-400 text-gray-900 font-bold py-2 px-6 rounded-lg hover:bg-lime-500 transition-colors">Tutup</button>
                    </div>
                </div>
            )}
            
            {/* All API Keys Failed Modal */}
            {isAllKeysFailedModalOpen && (
                <div className="modal-overlay" onClick={() => setIsAllKeysFailedModalOpen(false)}>
                    <div className="modal-content w-full max-w-md text-center" onClick={e => e.stopPropagation()}>
                        <h3 className="text-xl font-bold text-yellow-400 mb-4">Kunci API Gagal</h3>
                        <p className="text-gray-300 mb-6">
                           Semua kunci API yang Anda gunakan telah mencapai batas kuota atau tidak valid. Silakan masukkan kunci API yang lain untuk melanjutkan.
                        </p>
                        <button onClick={() => setIsAllKeysFailedModalOpen(false)} className="bg-lime-400 text-gray-900 font-bold py-2 px-6 rounded-lg hover:bg-lime-500 transition-colors">Tutup</button>
                    </div>
                </div>
            )}

            {/* Download Options Modal */}
            {modals.download && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal-content w-full max-w-md" onClick={e => e.stopPropagation()}>
                        <h3 className="text-xl font-bold text-white mb-6 text-center">Unduh Koleksi Foto</h3>
                        <p className="text-gray-400 text-center mb-6">Pilih rasio aspek untuk memotong semua gambar sebelum mengunduh sebagai file ZIP.</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <button onClick={() => handleDownloadZip(3 / 4)} className="bg-gray-700 hover:bg-lime-500 hover:text-gray-900 font-semibold py-3 px-4 rounded-lg transition-colors">Potrait (3:4)</button>
                            <button onClick={() => handleDownloadZip(1)} className="bg-gray-700 hover:bg-lime-500 hover:text-gray-900 font-semibold py-3 px-4 rounded-lg transition-colors">Square (1:1)</button>
                            <button onClick={() => handleDownloadZip()} className="bg-gray-700 hover:bg-lime-500 hover:text-gray-900 font-semibold py-3 px-4 rounded-lg transition-colors">Original</button>
                        </div>
                        <button onClick={closeModal} className="w-full mt-6 text-center text-gray-400 hover:text-white transition-colors">Batal</button>
                    </div>
                </div>
            )}

            {/* Lightbox Modal */}
            {modals.lightbox && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal-content p-2 bg-gray-900/50 border-0 max-w-4xl max-h-[95vh] w-auto h-auto" onClick={e => e.stopPropagation()}>
                        <img src={modals.lightbox} alt="Generated prewedding" className="max-w-full max-h-[85vh] object-contain rounded-lg" />
                         <div className="flex items-center justify-center gap-4 mt-4">
                            <button onClick={closeModal} className="text-gray-300 hover:text-white transition-colors font-semibold py-2 px-5 rounded-lg bg-gray-800/80">Tutup</button>
                            <button onClick={() => handleDownloadSingle(modals.lightbox!)} className="bg-lime-400 text-gray-900 font-bold py-2 px-5 rounded-lg hover:bg-lime-500 transition-colors">Unduh</button>
                        </div>
                    </div>
                </div>
            )}

            {/* API Key Management Modal */}
            {isApiModalOpen && (
                 <div className="modal-overlay">
                    <div className="modal-content w-full max-w-2xl" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-start">
                             <h3 className="text-2xl font-bold text-white mb-2">Kelola Kunci API Gemini</h3>
                            <button onClick={() => setIsApiModalOpen(false)} className="text-gray-400 hover:text-white text-3xl leading-none">&times;</button>
                        </div>
                        <p className="text-gray-400 mb-6 text-sm">Aplikasi ini memprioritaskan Kunci Sistem (jika ada), lalu menggunakan kunci yang Anda tambahkan. Kunci Anda disimpan dengan aman di browser.</p>
                       
                        <div className="bg-gray-900 p-4 rounded-lg mb-4">
                            <label htmlFor="api-key-input" className="block text-sm font-medium text-gray-300 mb-2">Tambahkan Kunci API Baru (satu per baris)</label>
                            <textarea id="api-key-input" value={apiKeyInput} onChange={e => setApiKeyInput(e.target.value)} rows={3} className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 focus:ring-lime-500 focus:border-lime-500 placeholder-gray-500" placeholder="Masukkan satu atau lebih kunci API di sini"></textarea>
                            <button onClick={handleSaveApiKeys} className="mt-2 bg-lime-400 text-gray-900 font-bold py-2 px-4 rounded-lg text-sm hover:bg-lime-500 transition-colors disabled:bg-gray-600" disabled={!apiKeyInput.trim()}>Simpan Kunci</button>
                        </div>

                        <div className="space-y-3">
                            <div className="flex justify-between items-center mb-2">
                                <h4 className="text-lg font-semibold text-white">Kunci Tersimpan</h4>
                                <button onClick={handleValidateKeys} disabled={isKeyValidationLoading || apiKeys.length === 0} className="text-sm bg-blue-600 text-white font-semibold py-1.5 px-3 rounded-md hover:bg-blue-700 transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed">
                                    {isKeyValidationLoading ? 'Memvalidasi...' : 'Validasi Semua'}
                                </button>
                            </div>
                             {apiKeys.length > 0 ? (
                                <ul className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-2">
                                    {apiKeys.map(key => (
                                        <li key={key.id} className={`flex items-center justify-between p-3 rounded-lg ${key.isSystem ? 'bg-blue-900/50 border border-blue-700/50' : 'bg-gray-900'}`}>
                                            <div className="flex flex-col">
                                                <span className="font-mono text-gray-200">{key.masked}</span>
                                                <ApiKeyStatusIndicator status={key.status} />
                                            </div>
                                            {!key.isSystem && (
                                                <button onClick={() => handleRemoveApiKey(key.id)} className="text-gray-500 hover:text-red-400 transition-colors p-1 text-2xl" title="Hapus Kunci">&times;</button>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            ) : <p className="text-gray-500 text-center py-4">Tidak ada kunci API yang tersimpan.</p>}
                        </div>
                    </div>
                </div>
            )}

            {/* Casual Inspiration Preview Modal */}
            {previewData && (
                <div className="modal-overlay" onClick={handleCancelPreviews}>
                    <div className="modal-content w-full max-w-4xl" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-white">✨ Inspirasi Pakaian Casual</h3>
                            <button onClick={handleCancelPreviews} className="text-gray-400 hover:text-white text-3xl leading-none">&times;</button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                            {/* Left Column */}
                            <div className="flex flex-col h-full">
                                <label className="text-sm font-medium text-gray-300 mb-2">Deskripsi yang Dihasilkan</label>
                                <div className="bg-gray-900 p-4 rounded-lg text-sm text-gray-300 flex-grow min-h-[150px]">
                                    {previewData.textPrompt || 'Klik "Buat Inspirasi" untuk memulai.'}
                                </div>
                                <button onClick={handleGenerateCasualPreview} disabled={previewData.isLoading} className="mt-4 bg-blue-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 w-full">
                                    {previewData.isLoading ? 'Membuat...' : previewData.textPrompt ? 'Buat Ulang' : 'Buat Inspirasi'}
                                </button>
                            </div>

                            {/* Right Column */}
                            <div className="flex items-center justify-center bg-gray-900 rounded-lg aspect-[3/4] p-4">
                                {previewData.isLoading ? (
                                    <div className="text-center">
                                        <div className="loader mx-auto"></div>
                                        <p className="mt-4 text-gray-300 text-sm">{previewData.statusText || 'Memuat...'}</p>
                                        {activeApiKeyMasked && <p className="text-xs text-gray-500 mt-1">{activeApiKeyMasked}</p>}
                                    </div>
                                ) : previewData.error ? (
                                    <div className="bg-red-900/30 border border-red-700 rounded-lg p-6 text-center text-red-300">
                                        <h4 className="font-bold text-lg mb-2">Oops! Gagal membuat preview.</h4>
                                        <p className="text-sm">{previewData.error}</p>
                                    </div>
                                ) : previewData.imageUrl ? (
                                    <img src={previewData.imageUrl} alt="Inspiration preview" className="rounded-lg object-cover w-full h-full" />
                                ) : (
                                    <p className="text-gray-500">Preview akan muncul di sini.</p>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-4 justify-center mt-6">
                            {previewData.imageUrl && !previewData.isLoading && <button onClick={() => handleUseInspiration(previewData.textPrompt, previewData.imageUrl!)} className="bg-lime-400 text-gray-900 font-bold py-3 px-8 rounded-lg hover:bg-lime-500 transition-colors">Gunakan Inspirasi Ini</button>}
                        </div>
                    </div>
                </div>
            )}

             {/* Adat Preview Modal */}
            {adatPreviewData && (
                 <div className="modal-overlay" onClick={handleCancelPreviews}>
                    <div className="modal-content w-full max-w-4xl" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                             <h3 className="text-xl font-bold text-white">✨ Inspirasi Pakaian Adat</h3>
                            <button onClick={handleCancelPreviews} className="text-gray-400 hover:text-white text-3xl leading-none">&times;</button>
                        </div>
                         
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                            {/* Left Column */}
                            <div className="flex flex-col space-y-4 h-full">
                                <div>
                                    <label htmlFor="adat-region" className="block text-sm font-medium text-gray-300 mb-2">Pakaian adat mana yang akan dibuat?</label>
                                    <div className="flex gap-2">
                                        <select
                                            id="adat-region"
                                            value={adatPreviewData.region}
                                            onChange={e => setAdatPreviewData(p => ({...p!, region: e.target.value}))}
                                            disabled={adatPreviewData.isLoading}
                                            className="flex-grow bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 focus:ring-lime-500 focus:border-lime-500"
                                        >
                                            <option value="" disabled>Pilih daerah...</option>
                                            {adatInspirations.map(adat => (
                                                <option key={adat.region} value={adat.region}>{adat.region}</option>
                                            ))}
                                        </select>
                                        <button onClick={handleGenerateAdatPreview} disabled={!adatPreviewData.region || adatPreviewData.isLoading} className="bg-blue-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">Buat</button>
                                    </div>
                                </div>
                                 <div className="flex flex-col flex-grow">
                                    <label className="text-sm font-medium text-gray-300 mb-2">Deskripsi Dihasilkan</label>
                                    <div className="bg-gray-900 p-4 rounded-lg text-sm text-gray-300 flex-grow min-h-[150px]">
                                        {adatPreviewData.textPrompt || 'Deskripsi akan dibuat di sini setelah Anda memilih daerah dan klik "Buat".'}
                                    </div>
                                </div>
                            </div>
                            
                            {/* Right Column */}
                             <div className="flex items-center justify-center bg-gray-900 rounded-lg aspect-[3/4] p-4">
                                {adatPreviewData.isLoading ? (
                                    <div className="text-center">
                                        <div className="loader mx-auto"></div>
                                        <p className="mt-4 text-gray-300 text-sm">{adatPreviewData.statusText || 'Memuat...'}</p>
                                         {activeApiKeyMasked && <p className="text-xs text-gray-500 mt-1">{activeApiKeyMasked}</p>}
                                    </div>
                                ) : adatPreviewData.error ? (
                                     <div className="bg-red-900/30 border border-red-700 rounded-lg p-6 text-center text-red-300">
                                        <h4 className="font-bold text-lg mb-2">Oops! Gagal membuat preview.</h4>
                                        <p className="text-sm">{adatPreviewData.error}</p>
                                    </div>
                                ) : adatPreviewData.imageUrl ? (
                                    <img src={adatPreviewData.imageUrl} alt="Inspiration preview" className="rounded-lg object-cover w-full h-full" />
                                ) : (
                                    <p className="text-gray-500">Preview akan muncul di sini.</p>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-center mt-6">
                             {adatPreviewData.imageUrl && !adatPreviewData.isLoading && <button onClick={() => handleUseInspiration(adatPreviewData.textPrompt, adatPreviewData.imageUrl!)} className="bg-lime-400 text-gray-900 font-bold py-3 px-8 rounded-lg hover:bg-lime-500 transition-colors">Gunakan Inspirasi Ini</button>}
                        </div>
                    </div>
                </div>
            )}

            {/* Manual Prompt Preview Modal */}
            {manualPreviewData && (
                <div className="modal-overlay" onClick={handleCancelPreviews}>
                    <div className="modal-content w-full max-w-4xl" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-white">📷 Preview dari Deskripsi Anda</h3>
                            <button onClick={handleCancelPreviews} className="text-gray-400 hover:text-white text-3xl leading-none">&times;</button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                            {/* Left Column */}
                            <div className="flex flex-col h-full">
                                <label className="text-sm font-medium text-gray-300 mb-2">Deskripsi Anda</label>
                                <div className="bg-gray-900 p-4 rounded-lg text-sm text-gray-300 flex-grow min-h-[150px]">
                                    {manualPreviewData.textPrompt}
                                </div>
                                <button onClick={handleGenerateManualPreview} disabled={manualPreviewData.isLoading} className="mt-4 bg-blue-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 w-full">
                                    {manualPreviewData.isLoading ? 'Membuat...' : manualPreviewData.imageUrl ? 'Buat Ulang' : 'Buat Preview'}
                                </button>
                            </div>

                            {/* Right Column */}
                            <div className="flex items-center justify-center bg-gray-900 rounded-lg aspect-[3/4] p-4">
                                {manualPreviewData.isLoading ? (
                                    <div className="text-center">
                                        <div className="loader mx-auto"></div>
                                        <p className="mt-4 text-gray-300 text-sm">{manualPreviewData.statusText || 'Memuat...'}</p>
                                        {activeApiKeyMasked && <p className="text-xs text-gray-500 mt-1">{activeApiKeyMasked}</p>}
                                    </div>
                                ) : manualPreviewData.error ? (
                                    <div className="bg-red-900/30 border border-red-700 rounded-lg p-6 text-center text-red-300">
                                        <h4 className="font-bold text-lg mb-2">Oops! Gagal membuat preview.</h4>
                                        <p className="text-sm">{manualPreviewData.error}</p>
                                    </div>
                                ) : manualPreviewData.imageUrl ? (
                                    <img src={manualPreviewData.imageUrl} alt="Manual prompt preview" className="rounded-lg object-cover w-full h-full" />
                                ) : (
                                    <p className="text-gray-500">Klik "Buat Preview" untuk melihat hasilnya.</p>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-4 justify-center mt-6">
                            {manualPreviewData.imageUrl && !manualPreviewData.isLoading && <button onClick={() => handleUseInspiration(manualPreviewData.textPrompt, manualPreviewData.imageUrl!)} className="bg-lime-400 text-gray-900 font-bold py-3 px-8 rounded-lg hover:bg-lime-500 transition-colors">Gunakan Ini Sebagai Referensi</button>}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default CommonModals;