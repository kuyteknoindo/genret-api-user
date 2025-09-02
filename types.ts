export interface GeneratedImage {
  id: string;
  url: string;
}

export interface ModalState {
  error: string | null;
  download: boolean;
  lightbox: string | null;
}

export interface ReferenceFile {
    base64: string;
    mimeType: string;
}

export type ActiveTab = 'prompt' | 'reference';

export type ApiKeyStatus = 'active' | 'invalid' | 'exhausted' | 'unvalidated';

export interface ApiKey {
  id: string;
  value: string;
  masked: string;
  status: ApiKeyStatus;
}
