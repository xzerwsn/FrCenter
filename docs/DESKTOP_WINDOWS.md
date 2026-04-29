# Desktop build for Windows

## Что уже настроено

- `desktop/` использует Tauri 2 и общий React/Vite frontend из `frontend/`.
- `tauri build` автоматически запускает `npm run build` во frontend перед упаковкой.
- Для Windows собирается NSIS installer (`.exe`).
- Backend URL можно поменять прямо в клиенте:
  - на экране входа;
  - в `Настройки -> Backend URL`.

## Требования

- Windows 10/11
- Node.js LTS
- Rust MSVC toolchain
- Visual Studio Build Tools с C++ workload

## Локальный запуск desktop-shell

```powershell
cd C:\tgg\desktop
npm install
npm run dev
```

Tauri поднимет окно desktop-клиента, а frontend будет взят из `http://localhost:5173`.

## Сборка `.exe`

```powershell
cd C:\tgg\desktop
npm install
npm run build
```

NSIS installer появится в папке:

```text
desktop\src-tauri\target\release\bundle\nsis\
```

Обычно файл имеет вид `FrCenter_<version>_x64-setup.exe`.

## Backend URL

- Базовый URL по умолчанию берётся из `frontend/.env*` через `VITE_BACKEND_URL`.
- После первой сборки его можно менять без пересборки: значение хранится локально на устройстве.
- Для production Windows desktop backend должен разрешать origin `http://tauri.localhost`. Этот origin уже добавлен в backend config и `.env.example`.
