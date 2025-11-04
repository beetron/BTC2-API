import Message from "../models/message.model.js";
import fs from 'fs';
import path from 'path';

const uploadsDir = path.join(process.cwd(), 'src', 'uploads', 'images');

export const handleImageFileCleanup = async (imageFiles) => {
  try {
    if (!imageFiles || imageFiles.length === 0) return;

    for (const imageFile of imageFiles) {
      // Check if file exists in database
      const remainingMessages = await Message.find({
        imageFiles: imageFile
      });

      if (remainingMessages.length === 0) {
        // No other messages reference this file, delete it
        const filePath = path.join(uploadsDir, imageFile);
        
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
