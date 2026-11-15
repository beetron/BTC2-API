import multer from "multer";
import sharp from "sharp";
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

// Photos are stored as JPEG, at most this many pixels on the long edge.
// 2560px at quality 88 keeps a typical 4032x3024 phone photo (about 3 MB)
// at roughly 1 MB, which still looks sharp full screen.
export const MAX_IMAGE_DIMENSION = 2560;
export const JPEG_QUALITY = 88;

// libvips keeps decoded images in a cache by default. Uploads are each read
// once, so the cache would only hold memory the pod (256 MiB limit) needs.
sharp.cache(false);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // The extension is the only part taken from the client: keep letters,
    // digits and the dot, so it can never carry a path, space or line break
    const extension = path.extname(file.originalname).replace(/[^A-Za-z0-9.]/g, "");
    cb(null, uuidv4() + extension);
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

// Re-encodes one uploaded file as a JPEG and returns the stored filename.
// - Rotated upright from its EXIF orientation, then all metadata (camera,
//   GPS location...) is dropped, since sharp only keeps it when asked.
// - Transparent areas (PNG, WebP) are filled with white instead of black.
// - Animated images (GIF, WebP) and formats sharp cannot read (HEIC) are
//   kept exactly as uploaded, so an upload never fails because of this.
export const compressImage = async (filename) => {
  const originalPath = path.join(uploadDir, filename);

  let output;
  try {
    const metadata = await sharp(originalPath).metadata();
    if ((metadata.pages ?? 1) > 1) return filename;

    let pipeline = sharp(originalPath)
      .autoOrient()
      .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      });
    if (metadata.hasAlpha) pipeline = pipeline.flatten({ background: "#ffffff" });
    output = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
  } catch (error) {
    // Line breaks removed: the filename's extension and sharp's message
    // (which repeats the path) come from the uploaded file, and must not
    // be able to forge extra log lines
    const detail = `${filename}: ${error.message}`.replace(/\n|\r/g, "");
    console.warn(`Keeping upload as sent, could not compress it (${detail})`);
    return filename;
  }

  // Written under a temporary name first: the original may be "<uuid>.JPG",
  // which is the same file as "<uuid>.jpg" on a case-insensitive disk
  const compressedName = path.parse(filename).name + ".jpg";
  const tempPath = path.join(uploadDir, path.parse(filename).name + ".tmp");
  await fs.promises.writeFile(tempPath, output);
  await fs.promises.unlink(originalPath);
  await fs.promises.rename(tempPath, path.join(uploadDir, compressedName));
  return compressedName;
};

const processImages = async (req, res, next) => {
  // Skip processing if no files are attached
  if (!req.files || req.files.length === 0) {
    req.filenames = []; // Set empty array so controller knows no files were uploaded
    return next();
  }

  try {
    // One at a time: decoding several full-size photos at once could go
    // past the pod's memory limit
    const filenames = [];
    for (const file of req.files) {
      filenames.push(await compressImage(file.filename));
    }
    req.filenames = filenames;
    next();
  } catch (error) {
    console.error("Error processing images: ", error);
    // Remove whatever this upload left on disk, compressed or not
    await Promise.all(
      req.files.flatMap((file) => {
        const name = path.parse(file.filename).name;
        return [file.filename, name + ".jpg", name + ".tmp"].map((f) =>
          fs.promises.rm(path.join(uploadDir, f), { force: true })
        );
      })
    );
    next(error);
  }
};

export { uploadImage, processImages };
