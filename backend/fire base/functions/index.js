const { onObjectFinalized } = require('firebase-functions/v2/storage');
const admin = require('firebase-admin');
const sharp = require('sharp');
const path = require('path');
const os = require('os');
const fs = require('fs');

const { classifier } = require('./classifier');

admin.initializeApp();

// Ensure classifier is initialized before standard execution
let isClassifierReady = false;

exports.processImage = onObjectFinalized(async (event) => {
    const object = event.data;
    const fileBucket = object.bucket;
    const filePath = object.name;
    const contentType = object.contentType;

    // Exit if this is triggered on a file that is not an image
    if (!contentType.startsWith('image/')) {
        return null;
    }

    // Prepare temp file path
    const fileName = path.basename(filePath);
    const tempFilePath = path.join(os.tmpdir(), fileName);
    
    const bucket = admin.storage().bucket(fileBucket);

    try {
        if (!isClassifierReady) {
            await classifier.init();
            isClassifierReady = true;
        }

        // 1. Download file to temp directory
        console.log(`Downloading ${filePath} to ${tempFilePath}`);
        await bucket.file(filePath).download({ destination: tempFilePath });

        // 2. Read image with sharp, resize, and get raw RGB values
        console.log('Resizing image and extracting features...');
        // We resize to 96x96 by default. If the model properties logs show a different size, update this.
        const targetWidth = 96;
        const targetHeight = 96;

        const buffer = await sharp(tempFilePath)
            .resize(targetWidth, targetHeight)
            .removeAlpha() // Ensure only RGB
            .raw()
            .toBuffer();

        // 3. Convert raw RGB buffer to the format expected by Edge Impulse
        // Most Edge Impulse models expect a flat array of floats (RGBRGB... or RRR...GGG...BBB...)
        // Default is interleaved RGB normalized to [0, 1]
        const features = [];
        for (let i = 0; i < buffer.length; i++) {
            features.push(buffer[i] / 255.0);
        }

        console.log(`Extracted ${features.length} features.`);

        // 4. Run classification
        console.log('Running Edge Impulse classification...');
        const result = classifier.classify(features);
        console.log('Classification result:', JSON.stringify(result));

        // 5. Determine the status
        let topResult = null;
        let maxConfidence = -1;
        
        if (result.results && result.results.length > 0) {
            for (const res of result.results) {
                if (res.value > maxConfidence) {
                    maxConfidence = res.value;
                    topResult = res.label;
                }
            }
        }
        
        if (topResult) {
            console.log(`Determined Status: ${topResult} (confidence: ${maxConfidence.toFixed(4)})`);

            // 6. Update Realtime Database
            const statusRef = admin.database().ref('/latest_print_status');
            await statusRef.set({
                status: topResult,
                confidence: parseFloat(maxConfidence.toFixed(4)),
                updatedAt: admin.database.ServerValue.TIMESTAMP,
                fileName: fileName // Track which file produced this result
            });
            console.log('Realtime database updated successfully.');
        } else {
            console.warn('No classification results found.');
        }

        // 7. Delete the original file from Storage as requested
        console.log(`Deleting ${filePath} from Storage...`);
        await bucket.file(filePath).delete();
        console.log('File deleted successfully.');

    } catch (error) {
        console.error('Error processing image:', error);
    } finally {
        // Cleanup local temp file
        if (fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            } catch (unlinkError) {
                console.error('Failed to delete temp file:', unlinkError);
            }
        }
    }
});

