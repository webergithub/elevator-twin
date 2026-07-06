# Elevator Digital Twin · 电梯数字孪生

A browser-based **elevator dispatch digital twin** built with Three.js — simulate multi-car group-control scheduling in 3D, watch an AI optimizer assign cars in real time, and connect real elevator data through a standard API. No build step, no install.

🌐 **Live demo:** https://opcstudio.cc/elevator-twin/

## Features

- **Physics simulation engine** — realistic elevator acceleration/deceleration, door timing, and passenger boarding/alighting behavior.
- **ElevatorAgent AI dispatch** — dynamically assigns cars to hall calls to minimize average waiting and travel time.
- **3D twin view** — watch every car's live state, floor requests, and load in an interactive Three.js scene.
- **Three-layer architecture** — simulation data layer + dispatch-optimization algorithm layer + 3D twin view layer.
- **Real-system integration API** — feed live elevator operation data in through a standard JSON interface, for group-control algorithm validation, teaching, and technical demos.
- **Bilingual** — full 中文 / English toggle.

## Run locally

```bash
# any static file server works, e.g.
ruby -run -e httpd . -p 5173
# then open http://localhost:5173/
```

Three.js is loaded from a CDN via an import map, so no `npm install` is required.

## About OPC Studio

This **elevator digital twin / 电梯数字孪生** is one of the projects from **[OPC Studio](https://opcstudio.cc/)** — an independent studio building AI-powered tools and interactive 3D experiences in the browser.

Explore more live projects:

- 🛗 **[ElevatorTwin · 电梯数字孪生](https://opcstudio.cc/elevator-twin/)** — this project
- ✈️ **[AirportTwin · 机场数字孪生](https://opcstudio.cc/airport-twin/)** — airport ground-operations digital twin
- 🏠 **[HouseTwin · 3D 住宅设计器](https://opcstudio.cc/house-twin/)** — parametric 3D home & interior designer
- ♟ **[BattleAI](https://opcstudio.cc/battleai/)** — watch LLMs battle in chess, xiangqi, gomoku and tetris
- 🌐 **All projects → [opcstudio.cc](https://opcstudio.cc/)**

## License

MIT
