. ~/.bashrc

# ~/bin path for `srv` and `data` scripts
if [ -z "$COLI_CONC_BASE" ]; then
    export COLI_CONC_BASE=$HOME
fi
PATH=$COLI_CONC_BASE/bin:$PATH

# Docker Stuff
PATH=/usr/bin:$PATH
export DOCKER_HOST="unix:///run/user/$(id -u)/docker.sock"

# Deno
export DENO_INSTALL="$HOME/.deno"
PATH="$DENO_INSTALL/bin:$PATH"
