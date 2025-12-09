const path = require('path');
const csInterface = new CSInterface();
const extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
const servicePath = path.join(extensionRoot, 'js/services/klingService');

// Force reload of the service module by clearing cache
// This is necessary because CEP/Node process persists and caches modules
if (require.cache[servicePath]) {
    delete require.cache[servicePath];
}

const KlingService = require(servicePath);

(function () {
    'use strict';

    // Globals
    // csInterface is already defined at top level
    let startLayerInfo = null;
    let endLayerInfo = null;
    let generatedVideoPath = null;

    // UI Elements
    const elements = {
        settingsBtn: document.getElementById('settingsBtn'),
        settingsPanel: document.getElementById('settingsPanel'),
        apiKeyInput: document.getElementById('apiKeyInput'),
        modeSelect: document.getElementById('modeSelect'),
        durationSelect: document.getElementById('durationSelect'),
        saveSettingsBtn: document.getElementById('saveSettingsBtn'),

        // Start/End Frame UI
        setStartBtn: document.getElementById('setStartBtn'),
        startLayerInfo: document.getElementById('startLayerInfo'),

        setEndBtn: document.getElementById('setEndBtn'),
        endLayerInfo: document.getElementById('endLayerInfo'),
        clearEndBtn: document.getElementById('clearEndBtn'),

        layerSelectionSection: document.getElementById('layerSelectionSection'),

        promptInput: document.getElementById('promptInput'),
        negativePromptInput: document.getElementById('negativePromptInput'),
        generateBtn: document.getElementById('generateBtn'),
        statusArea: document.getElementById('statusArea'),
        resultArea: document.getElementById('resultArea'),
        resultVideo: document.getElementById('resultVideo'),
        importBtn: document.getElementById('importBtn')
    };

    // Constants
    const STORAGE_KEY_API_KEY = 'kling_replicate_api_key';

    let initialized = false;
    function init() {
        if (initialized) return;
        initialized = true;

        console.log('Kling Extension initializing...');
        loadApiKey();
        loadExtendScript();
        attachEventListeners();

        // Initial layer check
        setTimeout(refreshLayer, 500);
    }

    // Ensure DOM is fully loaded befor running init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function loadExtendScript() {
        const extensionRoot = csInterface.getSystemPath(SystemPath.EXTENSION);
        csInterface.evalScript(`$.evalFile("${extensionRoot}/jsx/hostscript.jsx")`);
    }

    function attachEventListeners() {
        elements.settingsBtn.addEventListener('click', () => {
            elements.settingsPanel.classList.toggle('hidden');
        });

        elements.saveSettingsBtn.addEventListener('click', saveSettings);

        elements.modeSelect.addEventListener('change', (e) => {
            const mode = e.target.value;
            if (mode === 't2v') {
                elements.layerSelectionSection.classList.add('hidden');
            } else {
                elements.layerSelectionSection.classList.remove('hidden');
            }
            checkGenerateReady();
        });

        // Frame Setters
        elements.setStartBtn.addEventListener('click', () => setLayer('start'));
        elements.setEndBtn.addEventListener('click', () => setLayer('end'));
        elements.clearEndBtn.addEventListener('click', () => clearLayer('end'));

        elements.generateBtn.addEventListener('click', handleGenerate);

        elements.importBtn.addEventListener('click', handleImport);
    }

    function setLayer(type) {
        csInterface.evalScript('getSelectedLayerInfo()', (result) => {
            try {
                const info = JSON.parse(result);
                if (info.error) {
                    alert(info.error);
                } else {
                    updateLayerUI(type, info);
                }
            } catch (e) {
                console.error('Error parsing layer info', e);
            }
        });
    }

    function clearLayer(type) {
        updateLayerUI(type, null);
    }

    function updateLayerUI(type, info) {
        const isStart = type === 'start';
        const box = isStart ? elements.startLayerInfo : elements.endLayerInfo;

        if (info) {
            if (isStart) startLayerInfo = info;
            else endLayerInfo = info;

            const filename = info.sourcePath ? info.sourcePath.split(/[\\/]/).pop() : 'Unknown File';

            box.classList.remove('empty');
            box.innerHTML = `
                <div style="font-weight:600; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;" title="${info.name}">${info.name}</div>
                <div style="color:#aaa; font-size:10px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;" title="${filename}">${filename}</div>
             `;

            if (!isStart) elements.clearEndBtn.classList.remove('hidden');

        } else {
            if (isStart) startLayerInfo = null;
            else endLayerInfo = null;

            box.classList.add('empty');
            box.innerHTML = `<p>No Layer Set</p>`;

            if (!isStart) elements.clearEndBtn.classList.add('hidden');
        }

        // Check valid state for button
        checkGenerateReady();
    }

    function checkGenerateReady() {
        const mode = elements.modeSelect.value;
        if (mode === 'i2v' && (!startLayerInfo || !startLayerInfo.sourcePath)) {
            elements.generateBtn.disabled = true;
        } else {
            elements.generateBtn.disabled = false;
        }
    }

    // Stub definition to avoid crashing if referenced, though we replaced it
    function refreshLayer() { }

    function saveSettings() {
        const key = elements.apiKeyInput.value.trim();
        if (key) {
            localStorage.setItem(STORAGE_KEY_API_KEY, key);
            KlingService.init(key);
            alert('API Key Saved');
            elements.settingsPanel.classList.add('hidden');
        }
    }

    function loadApiKey() {
        const key = localStorage.getItem(STORAGE_KEY_API_KEY);
        if (key) {
            elements.apiKeyInput.value = key;
            KlingService.init(key);
            console.log('API Key loaded');
        }
        checkGenerateReady();
    }

    function appendStatus(msg) {
        elements.statusArea.classList.remove('hidden');
        const p = document.createElement('div');
        p.textContent = `> ${msg}`;
        elements.statusArea.appendChild(p);
        elements.statusArea.scrollTop = elements.statusArea.scrollHeight;
    }

    async function handleGenerate() {
        const prompt = elements.promptInput.value.trim();
        if (!prompt) {
            alert('Please enter a prompt');
            return;
        }

        const mode = elements.modeSelect.value;
        const duration = parseInt(elements.durationSelect.value);
        let sourcePath = null;

        if (mode === 'i2v') {
            if (!startLayerInfo || !startLayerInfo.sourcePath) {
                alert('No valid Start Frame set for Image-to-Video');
                return;
            }
            sourcePath = startLayerInfo.sourcePath;
        }

        const apiKey = localStorage.getItem(STORAGE_KEY_API_KEY);
        if (!apiKey) {
            alert('Please set Replicate API Key in settings');
            elements.settingsPanel.classList.remove('hidden');
            return;
        }

        // Re-init just in case
        KlingService.init(apiKey);

        elements.generateBtn.disabled = true;
        elements.statusArea.innerHTML = ''; // Clear status
        elements.resultArea.classList.add('hidden');

        try {
            appendStatus(`Preparing generation (${mode.toUpperCase()}, ${duration}s)...`);

            const negativePrompt = elements.negativePromptInput.value.trim();
            const endPath = (mode === 'i2v' && endLayerInfo) ? endLayerInfo.sourcePath : null;

            // 1. Generate Video
            const videoUrl = await KlingService.generateVideo(
                sourcePath, // Pass null if T2V
                prompt,
                negativePrompt,
                duration,
                appendStatus,
                endPath // New Parameter
            );

            appendStatus('Video generated! downloading...');

            // 2. Download Video
            generatedVideoPath = await KlingService.downloadVideo(videoUrl, appendStatus);

            appendStatus(`Saved to: ${generatedVideoPath}`);

            // 3. Show Result
            elements.resultVideo.src = generatedVideoPath; // Assuming browser can view local path (CEP can if local file access allowed)
            // Note: in recent CEF, file:// URLs might be blocked unless --allow-file-access props.
            // But we can try.
            elements.resultArea.classList.remove('hidden');

        } catch (err) {
            console.error(err);
            appendStatus(`ERROR: ${err.message}`);
            alert(`Generation Failed: ${err.message}`);
        } finally {
            elements.generateBtn.disabled = false;
        }
    }

    function handleImport() {
        if (!generatedVideoPath) return;

        // Escape backslashes for ExtendScript
        // Mac uses forward slashes, but just in case
        const safePath = generatedVideoPath.replace(/\\/g, '\\\\');

        csInterface.evalScript(`importVideo("${safePath}")`, (result) => {
            if (result === 'success') {
                alert('Imported successfully!');
            } else {
                alert('Import failed: ' + result);
            }
        });
    }



})();
