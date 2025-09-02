export function shuffleArray<T>(array: T[]): T[] {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
}

export function generateRandomFilename(prefix = 'prewedding', extension = 'jpeg'): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomString = '';
    for (let i = 0; i < 12; i++) {
        randomString += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${prefix}_${randomString}.${extension}`;
}

export function cropImageToAspectRatio(imageBlob: Blob, targetAspectRatio: number, targetWidth: number | null = null, targetHeight: number | null = null): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const imageUrl = URL.createObjectURL(imageBlob);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                URL.revokeObjectURL(imageUrl);
                return reject(new Error("Failed to get canvas context"));
            }

            let srcWidth = img.width;
            let srcHeight = img.height;
            let srcX = 0;
            let srcY = 0;

            const currentAspectRatio = srcWidth / srcHeight;

            if (currentAspectRatio > targetAspectRatio) {
                srcWidth = srcHeight * targetAspectRatio;
                srcX = (img.width - srcWidth) / 2;
            } else if (currentAspectRatio < targetAspectRatio) {
                srcHeight = srcWidth / targetAspectRatio;
                srcY = (img.height - srcHeight) / 2;
            }

            canvas.width = targetWidth || srcWidth;
            canvas.height = targetHeight || srcHeight;

            ctx.drawImage(img, srcX, srcY, srcWidth, srcHeight, 0, 0, canvas.width, canvas.height);

            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error("Canvas to Blob conversion failed"));
                }
            }, 'image/jpeg', 1.0);
            
            URL.revokeObjectURL(imageUrl);
        };
        img.onerror = () => {
             URL.revokeObjectURL(imageUrl);
             reject(new Error("Image failed to load"));
        }
        img.src = imageUrl;
    });
}
