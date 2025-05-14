import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define upload directory relative to current file
const uploadDir = path.join(__dirname, "../users/profileImage");

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Not an image! File must be an image."), false);
  }
};

const uploadFile = multer({
  storage: storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB limit
  },
  fileFilter: fileFilter,
}).single("profileImage");

const resizeImage = async (req, res, next) => {
  if (!req.file) return next();

  const filename = uuidv4() + ".jpg";

  try {
    await sharp(req.file.buffer)
      .resize(300, 300, {
        fit: "cover",
        position: "center",
      })
      .toFormat("jpeg")
      .jpeg({ quality: 90 })
      .toFile(path.join(uploadDir, filename));

    req.file.filename = filename;
    next();
  } catch (error) {
    console.error("Error resizing image: ", error);
    next(error);
  }
};

export { uploadFile, resizeImage };
// import multer from "multer";
// import { v4 as uuidv4 } from "uuid";
// import sharp from "sharp";

// const storage = multer.memoryStorage();

// const fileFilter = (req, file, cb) => {
//   if (file.mimetype.startsWith("image/")) {
//     cb(null, true);
//   } else {
//     cb(new Error("Not an image! File must be an image."), false);
//   }
// };

// const uploadFile = multer({
//   storage: storage,
//   limits: {
//     fileSize: 20 * 1024 * 1024, // 20 MB limit
//   },
//   fileFilter: fileFilter,
// }).single("profileImage");

// const resizeImage = async (req, res, next) => {
//   if (!req.file) return next();

//   const filename = uuidv4() + ".jpg";

//   try {
//     await sharp(req.file.buffer)
//       .resize(300, 300, {
//         fit: "cover",
//         position: "center",
//       })
//       .toFormat("jpeg")
//       .jpeg({ quality: 90 })
//       .toFile(`users/profileImage/${filename}`);

//     req.file.filename = filename;
//     next();
//   } catch (error) {
//     console.error("Error resizing image: ", error);
//     next(error);
//   }
// };

// export { uploadFile, resizeImage };
