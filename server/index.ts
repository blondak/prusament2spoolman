import {createApp} from './app.js';

const app = await createApp();
await app.listen({port: Number(process.env.PORT ?? 8080), host: '0.0.0.0'});
