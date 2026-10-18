import Message from "../models/message.model.js";
import fs from 'fs';
import path from 'path';

const uploadsDir = path.join(process.cwd(), 'src', 'uploads', 'images');

// How many filenames to check per query. One query per chunk instead of
// one per file keeps large purges (hundreds of images) cheap.
const CHUNK_SIZE = 200;

export const handleImageFileCleanup = async (imageFiles) => {
  try {
    if (!imageFiles || imageFiles.length === 0) return;

    const uniqueFiles = [...new Set(imageFiles.filter(Boolean))];

    for (let i = 0; i < uniqueFiles.length; i += CHUNK_SIZE) {
      const chunk = uniqueFiles.slice(i, i + CHUNK_SIZE);

      // Any file still listed on a remaining message must be kept
      const stillReferenced = new Set(
        await Message.distinct('imageFiles', { imageFiles: { $in: chunk } })
      );

      for (const imageFile of chunk) {
        if (stillReferenced.has(imageFile)) continue;

        // No other messages reference this file, delete it. basename()
        // keeps a malformed DB value from pointing outside the uploads dir.
        const filePath = path.join(uploadsDir, path.basename(imageFile));

        try {
          await fs.promises.unlink(filePath);
          console.log(`Deleted unused image file: ${imageFile}`);
        } catch (error) {
          console.error(`Error deleting image file ${imageFile}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error in image cleanup:', error);
  }
};
