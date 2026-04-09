const Module = require('./model/edge-impulse-standalone');

let classifierInitialized = false;

class EdgeImpulseClassifier {
    constructor() {
        this.initialized = false;
    }

    async init() {
        if (classifierInitialized) return;

        return new Promise((resolve, reject) => {
            Module.onRuntimeInitialized = () => {
                classifierInitialized = true;
                const ret = Module.init();
                if (typeof ret === 'number' && ret !== 0) {
                    return reject('init() failed with code ' + ret);
                }
                resolve();
            };
        });
    }

    _arrayToHeap(data) {
        let typedArray = new Float32Array(data);
        let numBytes = typedArray.length * typedArray.BYTES_PER_ELEMENT;
        let ptr = Module._malloc(numBytes);
        let heapBytes = new Uint8Array(Module.HEAPU8.buffer, ptr, numBytes);
        heapBytes.set(new Uint8Array(typedArray.buffer));
        return { ptr: ptr, buffer: heapBytes };
    }

    _fillResultStruct(ret) {
        const props = Module.get_properties();
        const jsResult = {
            anomaly: ret.anomaly,
            results: []
        };

        for (let cx = 0; cx < ret.size(); cx++) {
            const c = ret.get(cx);
            if (props.model_type === 'object_detection' || props.model_type === 'constrained_object_detection') {
                jsResult.results.push({ label: c.label, value: c.value, x: c.x, y: c.y, width: c.width, height: c.height });
            } else {
                jsResult.results.push({ label: c.label, value: c.value });
            }
            c.delete();
        }

        ret.delete();
        return jsResult;
    }

    classify(rawData, debug = false) {
        if (!classifierInitialized) throw new Error('Module is not initialized');

        const obj = this._arrayToHeap(rawData);
        const ret = Module.run_classifier(obj.buffer.byteOffset, rawData.length, debug);
        Module._free(obj.ptr);

        if (ret.result !== 0) {
            throw new Error('Classification failed (err code: ' + ret.result + ')');
        }

        return this._fillResultStruct(ret);
    }
}

const classifier = new EdgeImpulseClassifier();

module.exports = {
    classifier
};
