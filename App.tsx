import React, { useState, useCallback, useRef, useEffect } from 'react';
import { getApiKey, saveApiKey, validateApiKey, editImageWithPrompt } from './services/geminiService';
import { fileToBase64 } from './services/geminiService';
import { FileWithPreview, GeneratedImage } from './types';

// Declare FileSystemDirectoryHandle on the Window object for TypeScript
declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  }

  // Add missing type declarations for File System Access API permissions
  interface FileSystemHandlePermissionDescriptor {
    mode: 'read' | 'readwrite';
  }

  interface FileSystemHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }

  // Ensure FileSystemDirectoryHandle inherits FileSystemHandle methods
  interface FileSystemDirectoryHandle extends FileSystemHandle {}
}

const App: React.FC = () => {
  const [uploadedFiles, setUploadedFiles] = useState<FileWithPreview[]>([]);
  const [prompt, setPrompt] = useState<string>('');
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);

  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [selectedDirectoryName, setSelectedDirectoryName] = useState<string | null>(null);
  const [isPickerSupported, setIsPickerSupported] = useState<boolean>(false);

  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [isKeyValidating, setIsKeyValidating] = useState<boolean>(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (window.showDirectoryPicker && window.self === window.top) {
      setIsPickerSupported(true);
    } else {
      setIsPickerSupported(false);
      console.warn("File System Access API (showDirectoryPicker) is not supported in this environment (e.g., a cross-origin iframe). The automatic save feature will be disabled.");
    }
    
    const storedKey = getApiKey();
    if (storedKey) {
      setHasApiKey(true);
      setApiKeyInput(storedKey);
    } else {
      setIsSettingsOpen(true);
    }
  }, []);

  useEffect(() => {
    const storedImages = localStorage.getItem('generatedImages');
    if (storedImages) {
      try {
        const parsedImages: GeneratedImage[] = JSON.parse(storedImages);
        setGeneratedImages(parsedImages);
      } catch (e) {
        console.error("Failed to parse stored images from localStorage:", e);
        localStorage.removeItem('generatedImages');
      }
    }
  }, []);

  useEffect(() => {
    try {
      if (generatedImages.length > 0 || localStorage.getItem('generatedImages')) {
        localStorage.setItem('generatedImages', JSON.stringify(generatedImages));
      }
    } catch (e) {
      console.error("Failed to save images to localStorage:", e);
    }
  }, [generatedImages]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (selectedImage) setSelectedImage(null);
        else if (isSettingsOpen) setIsSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedImage, isSettingsOpen]);


  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const files = event.target.files;
    if (files && files.length > 0) {
      const newFilesWithPreviews: FileWithPreview[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const base64 = await fileToBase64(file);
        if (base64) {
          newFilesWithPreviews.push(Object.assign(file, { preview: `data:${file.type};base64,${base64}` }));
        }
      }
      setUploadedFiles((prev) => [...prev, ...newFilesWithPreviews]);
    }
  };

  const removeFile = useCallback((fileName: string) => {
    setUploadedFiles((prev) => prev.filter((file) => file.name !== fileName));
  }, []);

  const saveImageToFileSystem = useCallback(async (imageDataUrl: string, fileName: string) => {
    if (!directoryHandle) return;
    try {
      let permissionStatus = await directoryHandle.queryPermission({ mode: 'readwrite' });
      if (permissionStatus === 'prompt' || permissionStatus === 'denied') {
        permissionStatus = await directoryHandle.requestPermission({ mode: 'readwrite' });
      }
      if (permissionStatus !== 'granted') {
        alert("Không thể lưu ảnh tự động: Quyền ghi vào thư mục bị từ chối.");
        return;
      }
      const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      const response = await fetch(imageDataUrl);
      const blob = await response.blob();
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      console.error('Error saving image to file system:', error);
      alert(`Không thể lưu ảnh "${fileName}" tự động. Lỗi: ${(error as Error).message}`);
    }
  }, [directoryHandle]);

  const handleGenerate = useCallback(async () => {
    if (!hasApiKey) {
      setError('Vui lòng thiết lập Gemini API Key trong phần cài đặt trước khi tạo ảnh.');
      setIsSettingsOpen(true);
      return;
    }
    if (uploadedFiles.length === 0) {
      setError('Vui lòng tải lên ít nhất một ảnh để chỉnh sửa.');
      return;
    }
    if (!prompt.trim()) {
      setError('Vui lòng nhập lời nhắc chỉnh sửa ảnh.');
      return;
    }

    setIsLoading(true);
    setError(null);

    const newGeneratedImagesThisRun: GeneratedImage[] = [];
    for (const file of uploadedFiles) {
      try {
        const editedImageUrl = await editImageWithPrompt(file, prompt);
        if (editedImageUrl) {
          const newImage: GeneratedImage = {
            id: `${file.name}-${Date.now()}`,
            url: editedImageUrl,
            prompt: prompt,
            originalFileName: file.name,
          };
          newGeneratedImagesThisRun.push(newImage);
          if (directoryHandle) {
            const saveFileName = `gemini-generated-${Date.now()}.png`;
            await saveImageToFileSystem(editedImageUrl, saveFileName);
          }
        } else {
           setError((prev) => `${prev ? prev + '\n' : ''}Không thể tạo ảnh chỉnh sửa cho ${file.name}.`);
        }
      } catch (e: any) {
        console.error(`Error processing ${file.name}:`, e);
        const errorMessage = `Lỗi khi xử lý ảnh ${file.name}: ${e.message}`;
        setError((prev) => `${prev ? prev + '\n' : ''}${errorMessage}`);
        if (e.message && (e.message.includes('API Key') || e.message.includes('API key'))) {
          setHasApiKey(false);
          setIsSettingsOpen(true);
        }
      }
    }
    setGeneratedImages((prev) => [...newGeneratedImagesThisRun, ...prev]);
    setIsLoading(false);
  }, [uploadedFiles, prompt, directoryHandle, saveImageToFileSystem, hasApiKey]);

  const handleCopyPrompt = useCallback(() => {
    if (selectedImage?.prompt) {
      navigator.clipboard.writeText(selectedImage.prompt);
      alert('Lời nhắc đã được sao chép!');
    }
  }, [selectedImage]);

  const handleCopyImage = useCallback(async () => {
    if (selectedImage?.url) {
      if (typeof ClipboardItem === 'undefined') {
        alert('Trình duyệt của bạn không hỗ trợ sao chép ảnh trực tiếp.');
        return;
      }
      try {
        const response = await fetch(selectedImage.url);
        const blob = await response.blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        alert('Ảnh đã được sao chép!');
      } catch (error) {
        console.error('Không thể sao chép ảnh:', error);
        alert('Không thể sao chép ảnh.');
      }
    }
  }, [selectedImage]);

  const handleDeleteImage = useCallback(() => {
    if (selectedImage?.id) {
      setGeneratedImages((prev) => prev.filter((img) => img.id !== selectedImage.id));
      setSelectedImage(null);
      alert('Ảnh đã được xóa!');
    }
  }, [selectedImage]);

  const handleDownloadImage = useCallback(() => {
    if (!selectedImage) return;
    const link = document.createElement('a');
    link.href = selectedImage.url;
    const safePrompt = selectedImage.prompt.substring(0, 20).replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.download = `gemini_${selectedImage.originalFileName.split('.')[0]}_${safePrompt}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [selectedImage]);

  const handleSelectSaveDirectory = useCallback(async () => {
    if (!isPickerSupported) return;
    try {
      const dirHandle = await window.showDirectoryPicker!();
      setDirectoryHandle(dirHandle);
      setSelectedDirectoryName(dirHandle.name);
      alert(`Đã chọn thư mục: ${dirHandle.name} để lưu ảnh tự động.`);
    } catch (error) {
      console.error("Lỗi khi chọn thư mục:", error);
    }
  }, [isPickerSupported]);

  const handleSaveApiKey = useCallback(async () => {
    setIsKeyValidating(true);
    setApiKeyError(null);
    const isValid = await validateApiKey(apiKeyInput);
    if (isValid) {
      saveApiKey(apiKeyInput);
      setHasApiKey(true);
      setIsSettingsOpen(false);
      alert('API Key đã được lưu thành công!');
    } else {
      setApiKeyError('API Key không hợp lệ. Vui lòng kiểm tra lại và thử lại. Bạn có thể lấy key từ Google AI Studio.');
    }
    setIsKeyValidating(false);
  }, [apiKeyInput]);

  return (
    <div className="min-h-screen flex flex-col items-center p-4 bg-gray-900 text-gray-100">
      <header className="w-full max-w-7xl flex justify-between items-center mb-8">
        <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-600">
          Trình chỉnh sửa ảnh Gemini
        </h1>
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="p-2 rounded-full bg-gray-700 hover:bg-gray-600 transition-colors"
          title="Cài đặt API Key"
          aria-label="Mở cài đặt API Key"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.096 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </header>

      <div className="w-full max-w-7xl flex flex-col md:flex-row gap-8">
        <div className="w-full md:w-1/3 flex flex-col gap-8">
          <div className="bg-gray-800 rounded-xl shadow-2xl p-6 border border-gray-700">
            <h2 className="text-2xl font-semibold mb-4 text-blue-300">1. Tải lên ảnh của bạn</h2>
            <button onClick={() => fileInputRef.current?.click()} className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors">Chọn ảnh</button>
            <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={handleFileChange} className="hidden" />
            {uploadedFiles.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                {uploadedFiles.map((file) => (
                  <div key={file.name} className="relative group">
                    <img src={file.preview} alt={file.name} className="w-full h-24 object-cover rounded-md border-gray-600"/>
                    <button onClick={() => removeFile(file.name)} className="absolute top-1 right-1 bg-red-600 hover:bg-red-700 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity" aria-label={`Remove ${file.name}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                    <p className="text-xs text-gray-400 mt-1 truncate">{file.name}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gray-800 rounded-xl shadow-2xl p-6 border border-gray-700">
            <h2 className="text-2xl font-semibold mb-4 text-purple-300">2. Nhập lời nhắc chỉnh sửa</h2>
            <textarea className="w-full p-4 h-32 bg-gray-700 border-gray-600 rounded-lg focus:ring-purple-500 resize-y" placeholder="Ví dụ: 'Thêm bộ lọc cổ điển'" value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={isLoading}></textarea>
            {error && <p className="text-red-400 mt-2 text-sm whitespace-pre-line">{error}</p>}
          </div>

          <div className="w-full">
            <button onClick={handleGenerate} disabled={isLoading || uploadedFiles.length === 0 || !prompt.trim() || !hasApiKey} className="w-full py-4 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white text-xl font-bold rounded-xl shadow-lg transition-transform transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed">
              {isLoading ? 'Đang tạo ảnh...' : 'Tạo ảnh'}
            </button>
          </div>
        </div>

        <div className="w-full md:w-2/3 flex flex-col">
          <div className="bg-gray-800 rounded-xl shadow-2xl p-6 border border-gray-700 flex-grow flex flex-col">
            <h2 className="text-2xl font-semibold mb-4 text-green-300">3. Lịch sử tạo ảnh</h2>
            <button onClick={handleSelectSaveDirectory} disabled={!isPickerSupported} title={!isPickerSupported ? "Tính năng này không được hỗ trợ." : "Chọn thư mục để tự động lưu."} className="mb-4 py-2 px-4 bg-gray-600 hover:bg-gray-700 rounded-lg flex items-center self-start disabled:opacity-50">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
              Chọn thư mục lưu
            </button>
            {selectedDirectoryName && <p className="text-sm text-gray-400 mb-4">Đã chọn: <span className="font-medium text-blue-300">{selectedDirectoryName}</span></p>}
            
            <div className="flex-grow">
              {!isLoading && generatedImages.length === 0 && <div className="h-full flex items-center justify-center text-gray-400">Ảnh đã tạo sẽ xuất hiện ở đây.</div>}
              {generatedImages.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 overflow-y-auto max-h-[60vh] pr-2 custom-scrollbar items-start">
                  {generatedImages.map((image) => (
                    <div key={image.id} className="bg-gray-700 rounded-lg shadow-md overflow-hidden cursor-pointer hover:scale-105 transition-transform" onClick={() => setSelectedImage(image)}>
                      <img src={image.url} alt={`Generated from ${image.originalFileName}`} className="w-full h-auto"/>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {selectedImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80 p-4" onClick={() => setSelectedImage(null)}>
          <div className="relative bg-gray-800 rounded-lg shadow-lg max-w-full max-h-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="absolute top-4 left-4 flex gap-3 z-10">
               <button onClick={handleDownloadImage} className="bg-purple-600 hover:bg-purple-700 p-2 rounded-full" title="Tải xuống ảnh"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg></button>
               <button onClick={handleCopyPrompt} className="bg-green-600 hover:bg-green-700 p-2 rounded-full" title="Sao chép lời nhắc"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" /><path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" /></svg></button>
               <button onClick={handleCopyImage} className="bg-blue-600 hover:bg-blue-700 p-2 rounded-full" title="Sao chép ảnh"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-4 3 3 5-5V15zm0-12H4v2h12V3z" clipRule="evenodd" /></svg></button>
               <button onClick={handleDeleteImage} className="bg-red-600 hover:bg-red-700 p-2 rounded-full" title="Xóa ảnh"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
            </div>
            <button onClick={() => setSelectedImage(null)} className="absolute top-4 right-4 bg-gray-600 hover:bg-gray-700 p-2 rounded-full z-10" aria-label="Đóng"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            <img src={selectedImage.url} alt={`Generated from ${selectedImage.originalFileName}`} className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"/>
            <div className="absolute bottom-4 left-4 right-4 bg-gray-900 bg-opacity-75 p-3 rounded-md text-sm"><p>Ảnh gốc: {selectedImage.originalFileName}</p></div>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70" onClick={() => setIsSettingsOpen(false)}>
          <div className="bg-gray-800 rounded-xl shadow-2xl p-8 border border-gray-700 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-2xl font-semibold mb-4 text-blue-300">Cài đặt Gemini API Key</h2>
            <p className="text-gray-400 mb-6">
              Vui lòng cung cấp API key của bạn để sử dụng tính năng tạo ảnh. Bạn có thể lấy key từ{' '}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                Google AI Studio
              </a>.
            </p>
            <label htmlFor="apiKeyInput" className="text-sm font-medium text-gray-300 block mb-2">Your API Key</label>
            <input id="apiKeyInput" type="password" value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)} className="w-full p-3 bg-gray-700 border-gray-600 rounded-lg focus:ring-purple-500" placeholder="Nhập API key của bạn ở đây"/>
            {apiKeyError && <p className="text-red-400 mt-2 text-sm">{apiKeyError}</p>}
            <div className="flex justify-end gap-4 mt-8">
              <button onClick={() => setIsSettingsOpen(false)} className="py-2 px-5 bg-gray-600 hover:bg-gray-700 font-bold rounded-lg" disabled={isKeyValidating}>Hủy</button>
              <button onClick={handleSaveApiKey} className="py-2 px-5 bg-blue-600 hover:bg-blue-700 font-bold rounded-lg flex items-center disabled:opacity-50" disabled={isKeyValidating || !apiKeyInput.trim()}>
                {isKeyValidating && <svg className="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>}
                {isKeyValidating ? 'Đang xác thực...' : 'Lưu & Xác thực'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;