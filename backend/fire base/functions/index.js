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

/**
 * Helper to update the function's execution status in the Realtime Database.
 */
async function updateFunctionStatus(data) {
    try {
        const statusRef = admin.database().ref('/function_status');
        await statusRef.update({
            ...data,
            lastUpdated: admin.database.ServerValue.TIMESTAMP
        });
    } catch (error) {
        console.error('Error updating function status:', error);
    }
}

/**
 * Counts the number of image files in the storage bucket to determine queue length.
 */
async function getQueueCount(bucket) {
    try {
        const [files] = await bucket.getFiles();
        // Count all files in the bucket (since they are all images intended for processing)
        return files.length;
    } catch (error) {
        console.error('Error counting files:', error);
        return 0;
    }
}

exports.processImage = onObjectFinalized(async (event) => {
    const object = event.data;
    const fileBucket = object.bucket;
    const filePath = object.name;
    const contentType = object.contentType;

    // Exit if this is triggered on a file that is not an image
    if (!contentType.startsWith('image/')) {
        return null;
    }

    const bucket = admin.storage().bucket(fileBucket);
    const fileName = path.basename(filePath);
    const tempFilePath = path.join(os.tmpdir(), fileName);

    try {
        // Fetch current queue count
        const queueCount = await getQueueCount(bucket);

        // Initial status update
        await updateFunctionStatus({
            currentTask: 'Starting...',
            fileName: fileName,
            queueCount: queueCount,
            state: 'active',
            error: null
        });

        if (!isClassifierReady) {
            await classifier.init();
            isClassifierReady = true;
        }

        // 1. Download file to temp directory
        console.log(`Downloading ${filePath} to ${tempFilePath}`);
        await updateFunctionStatus({ currentTask: 'Downloading image...' });
        await bucket.file(filePath).download({ destination: tempFilePath });

        // 2. Read image with sharp, resize, and get raw RGB values
        console.log('Resizing image and extracting features...');
        await updateFunctionStatus({ currentTask: 'Processing image (Resizing)...' });
        
        // Target size based on Edge Impulse model
        const targetWidth = 96;
        const targetHeight = 96;

        const buffer = await sharp(tempFilePath)
            .resize(targetWidth, targetHeight)
            .removeAlpha() // Ensure only RGB
            .raw()
            .toBuffer();

        // 3. Convert raw RGB buffer to the format expected by Edge Impulse
        const features = [];
        for (let i = 0; i < buffer.length; i++) {
            features.push(buffer[i] / 255.0);
        }

        console.log(`Extracted ${features.length} features.`);

        // 4. Run classification
        console.log('Running Edge Impulse classification...');
        await updateFunctionStatus({ currentTask: 'Classifying image...' });
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

            // 6. Update Realtime Database with result
            await updateFunctionStatus({ currentTask: 'Updating database...' });
            const statusRef = admin.database().ref('/latest_print_status');
            await statusRef.set({
                status: topResult,
                confidence: parseFloat(maxConfidence.toFixed(4)),
                updatedAt: admin.database.ServerValue.TIMESTAMP,
                fileName: fileName
            });
            console.log('Realtime database updated successfully.');
        } else {
            console.warn('No classification results found.');
        }

        // 7. Delete the original file from Storage
        console.log(`Deleting ${filePath} from Storage...`);
        await updateFunctionStatus({ currentTask: 'Cleaning up...' });
        await bucket.file(filePath).delete();
        console.log('File deleted successfully.');

        // Final status update (Idle)
        await updateFunctionStatus({ 
            currentTask: 'Idle',
            state: 'idle',
            queueCount: Math.max(0, queueCount - 1)
        });

    } catch (error) {
        console.error('Error processing image:', error);
        await updateFunctionStatus({ 
            currentTask: 'Error',
            state: 'error',
            error: error.message
        });
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


