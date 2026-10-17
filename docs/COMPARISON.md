# Our overlay and arth-agrawal/OpenCluely

Checked 17 October 2026. Our app is the local **OpenCluely Overlay 2.3.0** adaptation of `ashokchilka99/opencluely-overlay`. The other repository URL now redirects to **arth-agrawal/GodsPlan**. This comparison uses its pinned [14558a6 source](https://github.com/arth-agrawal/GodsPlan/tree/14558a6cfa1c041d26684f8d226a41cc75fec5c9), not older screenshots or dormant legacy code. Its current entry point is `workspace/main.js` ([package](https://github.com/arth-agrawal/GodsPlan/blob/14558a6cfa1c041d26684f8d226a41cc75fec5c9/package.json)). The comparison is a source review; the other app was not installed or executed.

| Area | Our OpenCluely Overlay 2.3 | Other repository's current GodsPlan workspace |
| --- | --- | --- |
| Main purpose | General text/image assistant | DSA/MCQ practice, selectable coding language and reasoning effort |
| Providers/models | OpenAI / ChatGPT, Claude, Gemini; 16 catalog choices plus custom IDs | OpenAI and Claude; four fixed choices |
| Conversation | Optional encrypted current-chat restoration and previous-chat archives; New chat, reopen, export | One current chat in memory; New chat or app exit clears it |
| Capture | Selected display or display under pointer; preview, upload, clipboard paste and drop | Capture/preview/crop and native screen/window picker on macOS 15+ |
| Instructions | Built-in general assistant instructions | Editable shared Markdown context, loaded for each request |
| Recovery | Repeated reopening with bounded backoff; pause until next explicit open; confirmed Quit stops it | First exit restarts immediately, second waits five minutes, third stays stopped; optional bounded Terminal guard |
| Installation/runtime | Packaged Electron app and small native Swift recovery helper; no Terminal, Python or Node needed to run | Documented source installer requires Node, npm, Python, Git and Command Line Tools; native launcher and Python supervisor |

Model restrictions, conversation lifetime, language/effort and shared context are explicit in the other app's [state implementation](https://github.com/arth-agrawal/GodsPlan/blob/14558a6cfa1c041d26684f8d226a41cc75fec5c9/workspace/state.js). Capture and active IPC behavior are in its [workspace main](https://github.com/arth-agrawal/GodsPlan/blob/14558a6cfa1c041d26684f8d226a41cc75fec5c9/workspace/main.js). Installation, crop/picker flow and recovery policy are documented in its [README](https://github.com/arth-agrawal/GodsPlan/blob/14558a6cfa1c041d26684f8d226a41cc75fec5c9/README.md) and implemented in its [supervisor](https://github.com/arth-agrawal/GodsPlan/blob/14558a6cfa1c041d26684f8d226a41cc75fec5c9/scripts/mac-supervisor.py).

Our advantages are standalone installation, broader provider/model selection, saved conversations, and the owner-controlled repeated reopening you requested. Our disadvantages are the absence of built-in screenshot cropping, a native window picker, editable shared instructions, and dedicated practice/language/effort controls. Those make the other workspace more convenient for structured question practice. Its in-memory chat also leaves less conversation text on disk by default; ours can match that preference by turning restoration off.

The other app offers a selected-model API test that makes a small generation request; our key verification only checks model metadata, so a saved key does not prove access to every selected model. Our custom-ID option is flexible but accepts account-specific IDs that can fail at request time. Preview and legacy entries can change or disappear.

Both use Electron and native background components. Neither is immune to Force Quit, process signals, an administrator, shutdown, or removal. Both describe Mac capture protection as best effort. We have not benchmarked them against each other, so there is no supported claim that either is faster or uses less memory. Our local package is ad hoc signed and not notarized.
