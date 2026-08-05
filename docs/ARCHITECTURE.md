# Architecture Overview

The project is organised into three layers:

1. **core/** – Headless library that owns retrieval, prompt rendering, LLM providers and the chat pipeline.  It exposes
   Pydantic models (`ChatRequest`, `ChatResponse`, etc.) and helpers to build prompts or stream responses.
2. **api/** – Thin FastAPI adapters that translate HTTP requests into core calls.  These routers handle auth, request
   validation and markdown→HTML conversion.  Streaming uses Server‑Sent Events with `meta`, `delta`, `done` and `error`
   chunks.
3. **ui/** – Browser side ES module SDK (`DKClient`) and vanilla controllers.  Controllers never call `fetch` directly;
   instead they use `DKClient` for chat, streaming and settings.

The separation allows the core library to be reused in other apps while this repo provides a full FastAPI + JS
implementation.  A minimal example of using the browser SDK:

```js
import { DKClient } from "./static/js/ui/sdk/sdk.js";
const dk = new DKClient();
const resp = await dk.chat({ message: "hello" });
```

```text
Browser UI ──HTTP──► api/ routers ──calls──► core/ pipeline ──► LLM & ChromaDB
```

The same registered `search` implementation serves interactive `/search`
requests, so direct search and model-initiated retrieval share validation and
execution behavior.

<img width="2600" height="1600" alt="semantic-search-pipeline" src="https://github.com/user-attachments/assets/c90fe6bf-6a69-41c1-b828-0f503f4c7a81" />
<img width="2600" height="1600" alt="bm25-search-pipeline" src="https://github.com/user-attachments/assets/d1c87729-a392-454e-9478-ae4e9f3f7cae" />
<img width="2600" height="1600" alt="hybrid-search-pipeline" src="https://github.com/user-attachments/assets/6c46792c-637b-4253-801e-57c75ec5797a" />

Return to [README](../README.md) or browse the [API reference](API_REFERENCE.md).
