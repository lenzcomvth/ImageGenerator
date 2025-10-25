import { GoogleGenAI, Modality } from '@google/genai';
import { FileWithPreview } from '../types';

/**
 * Encodes a File object into a base64 string.
 * @param file The File object to encode.
 * @returns A Promise that resolves with the base64 encoded string, or null if an error occurs.
 */
export async function fileToBase64(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const base64 = reader.result.split(',')[1]; // Remove data:image/jpeg;base64, prefix
        resolve(base64);
      } else {
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * Retrieves the Gemini API key from local storage.
 * @returns The API key string, or null if not found.
 */
export function getApiKey(): string | null {
  return localStorage.getItem('geminiApiKey');
}

/**
 * Saves the Gemini API key to local storage.
 * @param apiKey The API key to save.
 */
export function saveApiKey(apiKey: string): void {
  localStorage.setItem('geminiApiKey', apiKey);
}

/**
 * Retrieves the selected Gemini model from local storage.
 * @returns The model name string, or a default value if not found.
 */
export function getModel(): string {
  return localStorage.getItem('geminiModel') || 'gemini-2.5-flash-image';
}

/**
 * Saves the selected Gemini model to local storage.
 * @param model The model name to save.
 */
export function saveModel(model: string): void {
  localStorage.setItem('geminiModel', model);
}


/**
 * Validates a Gemini API key by making a simple test request.
 * @param apiKey The API key to validate.
 * @returns A Promise that resolves to true if the key is valid, false otherwise.
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  if (!apiKey) return false;
  try {
    const ai = new GoogleGenAI({ apiKey });
    // Use a simple, low-cost model for validation
    await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'test',
    });
    return true;
  } catch (error: any) {
    console.error("API Key validation failed:", error);
     // A quota error means the key is valid but has no quota.
     // We should allow the user to save it and see the specific error on generation.
    if (error.message && (error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('"code":429'))) {
      return true;
    }
    return false;
  }
}

/**
 * Edits a single image using a text prompt via the Gemini API.
 * @param file The File object to edit.
 * @param prompt The text prompt for editing.
 * @param model The Gemini model to use for the generation.
 * @returns A Promise that resolves with the base64 encoded edited image, or null if an error occurs.
 */
export async function editImageWithPrompt(
  file: FileWithPreview,
  prompt: string,
  model: string,
): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      'Chưa cấu hình Gemini API key. Vui lòng thiết lập trong cài đặt.',
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  const base64Image = await fileToBase64(file);

  if (!base64Image) {
    throw new Error('Không thể mã hóa ảnh sang base64.');
  }

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: file.type,
            },
          },
          {
            text: prompt,
          },
        ],
      },
      config: {
        responseModalities: [Modality.IMAGE],
      },
    });

    if (
      !response.candidates ||
      response.candidates.length === 0 ||
      !response.candidates[0].content ||
      !response.candidates[0].content.parts
    ) {
      console.error('Image generation failed or was blocked. Feedback:', response.promptFeedback);
      throw new Error('Không thể tạo ảnh. Yêu cầu của bạn có thể đã vi phạm chính sách an toàn.');
    }

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    return null; // No image data found in response
  } catch (error: any) {
    console.error('Lỗi khi chỉnh sửa ảnh với Gemini API:', error);
    
    // Handle specific quota/billing errors with a user-friendly message.
    if (error.message && (error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('"code":429'))) {
      throw new Error(
        'Lỗi Hạn mức (Quota Exceeded):\n' +
        'API Key của bạn đã hết hạn mức sử dụng miễn phí. \n' +
        'Vui lòng bật tính năng thanh toán (billing) cho dự án Google Cloud của bạn để tiếp tục.\n\n' +
        'Truy cập: ai.google.dev/gemini-api/docs/billing để biết thêm chi tiết.'
      );
    }
    
    // Provide a more user-friendly error message for common API key issues.
    if (error.message && (error.message.includes('API_KEY_INVALID') || error.message.includes('permission'))) {
      throw new Error('API Key không hợp lệ hoặc không có quyền cần thiết. Vui lòng kiểm tra lại key trong cài đặt.');
    }
    // Re-throw other errors, potentially wrapping them for clarity.
    throw new Error(error.message || 'Đã xảy ra lỗi không xác định.');
  }
}