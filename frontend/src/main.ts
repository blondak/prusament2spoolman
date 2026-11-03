import { createApp } from 'vue';
import { setZXingModuleOverrides } from 'vue-qrcode-reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import App from './App.vue';
import './style.css';

setZXingModuleOverrides({ locateFile: (path, prefix) => path.endsWith('zxing_reader.wasm') ? wasmUrl : `${prefix || ''}${path}` });
createApp(App).mount('#app');
