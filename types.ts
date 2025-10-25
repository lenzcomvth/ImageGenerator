
export interface FileWithPreview extends File {
  preview: string;
}

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  originalFileName: string;
}
