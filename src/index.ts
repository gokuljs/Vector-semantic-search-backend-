import express, { Request, Response, NextFunction } from "express";
import multer, { MulterError } from "multer";
import cors from "cors";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import s3Client from "./s3Client.js";
import dotenv from "dotenv";
import { pool } from "./dbSetup.js";
import { createTableAndTrigger } from "./setupImageUploadTable.js";

dotenv.config();

const app = express();
const upload = multer(); // Using multer's default memory storage
app.use(cors()); // This will enable all CORS requests. For production, configure this properly.
createTableAndTrigger();

app.post(
  "/upload",
  upload.array("images"),
  async (req: Request, res: Response) => {
    if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
      return res.status(400).send("No files were uploaded.");
    }

    const files = req.files as Express.Multer.File[];
    const uploadPromises = files.map((file) => uploadToS3(file));
    try {
      const results = await Promise.all(uploadPromises);
      const insertPromises = results.map((url) =>
        pool.query(
          "INSERT INTO image_uploads (image_url) VALUES ($1) RETURNING *",
          [url]
        )
      );
      const insertedRecords = await Promise.all(insertPromises);
      res.status(200).send(insertedRecords.map((record) => record.rows[0]));
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).send("Error uploading files.");
    }
  }
);

const uploadToS3 = async (file: Express.Multer.File): Promise<string> => {
  const key = `${Date.now()}_${file.originalname}`;
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    Body: file.buffer,
  });
  await s3Client.send(command);
  return getSignedUrl(s3Client, command, { expiresIn: 3600 }); // Generates a signed URL for accessing the object; adjust expiresIn as needed
};

const port = process.env.PORT || 2000;
app.listen(port, () => console.log(`Server running on port ${port}`));
