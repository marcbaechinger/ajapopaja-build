# Neovim Setup for Ajapopaja Build (uv Monorepo)

To ensure that Neovim's Language Server Protocol (LSP) correctly resolves Python dependencies and provides accurate type-checking/autocompletion for the `uv` workspace, follow these configuration guidelines.

## 1. The Strategy: Root-Based Resolution
In this monorepo, all Python dependencies are managed in `backend/.venv`. Since we recommend opening Neovim from the **project root**, your LSP needs to be explicitly told where the virtual environment is located.

---

## 2. Option A: Configuration File (Recommended)
This is the most portable and "low-touch" method. Pyright and Basedpyright look for this file automatically.

Create a `pyrightconfig.json` file in the **project root**:

```json
{
  "venvPath": "backend",
  "venv": ".venv",
  "executionEnvironments": [
    {
      "root": "backend/core",
      "extraPaths": ["backend/core/src"]
    },
    {
      "root": "backend/api",
      "extraPaths": ["backend/api/src", "backend/core/src"]
    },
    {
      "root": "backend/mcp",
      "extraPaths": ["backend/mcp/src", "backend/core/src"]
    }
  ]
}
```

---

## 3. Option B: Neovim Plugin (Best UX)
Use the **[venv-selector.nvim](https://github.com/linux-cultist/venv-selector.nvim)** plugin to dynamically switch between environments or let it auto-detect the `uv` structure.

### Lazy.nvim Configuration:
```lua
{
  "linux-cultist/venv-selector.nvim",
  branch = "regexp", -- Recommended branch for modern venv detection
  dependencies = { 
    "neovim/nvim-lspconfig", 
    "nvim-telescope/telescope.nvim", 
    "mfussenegger/nvim-dap-python" 
  },
  opts = {
    settings = {
      options = {
        activate_venv_in_terminal = true,
      },
      search = {
        uv_vms = {
          command = "fd .venv$ --full-path --color never -E /proc -E /dev -E /sys -E /run",
        },
      },
    },
  },
  keys = {
    { "<leader>vs", "<cmd>VenvSelect<cr>", desc = "Select VirtualEnv" },
  },
}
```

---

## 4. Option C: Manual LSP Configuration
If you prefer to configure `nvim-lspconfig` directly in your `init.lua`, you can programmatically point the LSP to the `backend/.venv`.

```lua
require('lspconfig').pyright.setup({
  on_init = function(client)
    -- Resolve the path to the backend venv relative to the project root
    local venv_python = client.config.root_dir .. "/backend/.venv/bin/python"
    
    if vim.fn.executable(venv_python) == 1 then
      client.config.settings.python.pythonPath = venv_python
    end
  end,
})
```

---

## 5. Verification
To verify your setup is working:
1. Open a file in `backend/api/src/api/main.py`.
2. Run `:LspInfo` and ensure the root directory is correctly identified.
3. Check for errors on lines like `from core.db import init_db`. If there are no "Module not found" errors, your configuration is successful.

## 6. Pro-Tip: Path Context
If you are working on the `core` package and it is not being resolved by `api` or `mcp`, remember that `uv sync` must be run in the `backend/` directory to link the workspace members correctly in the `.venv`.
