import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import sharp from "sharp";

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

const resizeImage = async (req, next) => {
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
      .toFile(`users/profileImage/${filename}`);

    req.file.filename = filename;
    next();
  } catch (error) {
    next(error);
  }
};

export { uploadFile, resizeImage };
