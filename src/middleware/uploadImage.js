import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define upload directory relative to current file
const uploadDir = path.join(__dirname, "../uploads/images");

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const filename = uuidv4() + path.extname(file.originalname);
    cb(null, filename);
  },
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Not an image! File must be an image."), false);
  }
};

const uploadImage = multer({
  storage: storage,
  limits: {
    fileSize: 30 * 1024 * 1024, // 30 MB limit
  },
  fileFilter: fileFilter,
}).array("messageImages", 10); // Allow up to 10 images per message

const processImages = async (req, res, next) => {
  // Skip processing if no files are attached
  if (!req.files || req.files.length === 0) {
    req.filenames = []; // Set empty array so controller knows no files were uploaded
    return next();
  }

  try {
    req.filenames = req.files.map((file) => file.filename);
    next();
  } catch (error) {
    console.error("Error processing images: ", error);
    next(error);
  }
};

export { uploadImage, processImages };
