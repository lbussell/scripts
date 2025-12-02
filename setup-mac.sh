#!/bin/bash
set -euo pipefail

# Function: run_atomically
# Arguments:
#   $1 - Semaphore ID (a unique string name for the operation)
#   $2... - The command to run (function name or command string)
# Function: run_atomically
# Usage: run_atomically "id_string" command [args...]
run_atomically() {
    local semaphore_id="$1"
    shift
    local semaphore_dir=".semaphores"
    local semaphore_file="${semaphore_dir}/${semaphore_id}"

    # Ensure the directory exists
    if [[ ! -d "$semaphore_dir" ]]; then
        mkdir -p "$semaphore_dir"
    fi

    # 1. Check if semaphore exists
    if [[ -f "$semaphore_file" ]]; then
        echo "  Skip '$semaphore_id' (already completed)."
        return 0
    fi

    echo "Running: '$semaphore_id'..."

    # 2. Run the passed command
    # Disable exit-on-error temporarily to capture the status manually
    set +e
    "$@"
    local status=$?
    set -e

    # 3. Create semaphore only if successful
    if [[ $status -eq 0 ]]; then
        touch "$semaphore_file"
        echo "Success: '$semaphore_id' completed and marked."
    else
        echo "Error: '$semaphore_id' failed. Semaphore not created."
        # Manually return the error code to stop the script (due to set -e at top level)
        return $status
    fi
}

fix_dock() {
    # Mac dock is really slow by default, speed it up
    defaults write com.apple.dock "autohide-delay" -float "0"
    defaults write com.apple.dock "autohide-time-modifier" -float "0.4"
    killall Dock
}

install_homebrew() {
    # Install homebrew (https://brew.sh/)
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add Homebrew to PATH and current shell session
    echo >> /Users/loganbussell/.zprofile
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> /Users/loganbussell/.zprofile
    eval "$(/opt/homebrew/bin/brew shellenv)"
    brew -v
}

brew_install_cask_atomic() {
    local cask_name="$1"
    echo "> Installing ${cask_name}..."
    run_atomically "install_cask_${cask_name}" brew install --cask "${cask_name}"
}

brew_install_atomic() {
    local package_name="$1"
    echo "> Installing ${package_name}..."
    run_atomically "install_${package_name}" brew install "${package_name}"
}

install_ghcp_cli() {
    echo "> Installing ghcp..."
    brew_install_atomic "npm"
    # https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli
    npm install -g @github/copilot
}

create_src() {
    echo "> Creating ~/src..."
    if [[ ! -d ~/src ]]; then
        mkdir -p ~/src
    else
        echo "~/src already exists, skipping."
    fi
}

# Arguments: $1 - repo URL, $2 - optional upstream repo URL
clone_repo() {
    local repo_url="$1"
    local upstream_url="${2:-}"
    local repo_name
    repo_name=$(basename -s .git "$repo_url")
    local target_dir="$repo_name"

    if [[ -d "$target_dir" ]]; then
        echo "Repository '$repo_name' already cloned, skipping."
        return 0
    fi

    echo "> Cloning repository '$repo_name'..."
    git clone "$repo_url" "$target_dir"

    if [[ -n "$upstream_url" ]]; then
        echo "> Adding upstream remote for '$repo_name'..."
        git -C "$target_dir" remote add upstream "$upstream_url"
    fi
}

clone_repo_atomic() {
    local repo_url="$1"
    local upstream_url="${2:-}"
    local repo_name
    repo_name=$(basename -s .git "$repo_url")
    run_atomically "clone_${repo_name}" clone_repo "$repo_url" "$upstream_url"
}

# Initial setup
run_atomically "fix_dock" fix_dock
run_atomically "install_homebrew" install_homebrew

# Install homebrew packages
brew_install_cask_atomic "ghostty"
brew_install_cask_atomic "claude-code"
brew_install_cask_atomic "git-credential-manager"
brew_install_cask_atomic "powershell"
brew_install_atomic "azure-cli"
brew_install_atomic "structuredlogviewer"

# Specialized installs
run_atomically "install_ghcp_cli" install_ghcp_cli

# Clone repos
run_atomically "create_src" create_src
pushd ~/src
                  # Repo URL                                                        # Upstream URL
clone_repo_atomic "https://github.com/lbussell/dotnet-docker"                       "https://github.com/dotnet/dotnet-docker"
clone_repo_atomic "https://github.com/lbussell/docker-tools"                        "https://github.com/dotnet/docker-tools"
clone_repo_atomic "https://github.com/lbussell/dotnet-buildtools-prereqs-docker"    "https://github.com/dotnet/dotnet-buildtools-prereqs-docker"
clone_repo_atomic "https://github.com/lbussell/arcade"                              "https://github.com/dotnet/arcade"
clone_repo_atomic "https://github.com/lbussell/dotnet-framework-docker"             "https://github.com/microsoft/dotnet-framework-docker"
popd

# Update any outdated packages. Run this every time.
brew update

echo "> All operations finished."
