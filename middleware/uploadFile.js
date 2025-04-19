import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "users/profileImage");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueSuffix);
  },
});

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
    fileSize: 5 * 1024 * 1024, // 5 MB limit
  },
  fileFilter: fileFilter,
}).single("profileImage");

export default uploadFile;
