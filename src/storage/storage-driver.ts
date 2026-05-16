export interface StorageDriver {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
}
