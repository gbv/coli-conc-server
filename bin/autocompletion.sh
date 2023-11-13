# Simple autocompletion for server script
# TODOs:
# - Maybe get available options and commands from the script itself?
# - Improve heuristic for determining whether a command is already given.
_server() 
{
    local cur prev commands options targets
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"
    
    # Handle options
    options="--help"
    if [[ ${cur} == -* ]] ; then
        COMPREPLY=( $(compgen -W "${options}" -- ${cur}) )
        return 0
    fi

    # If command is already given, match via filename targets
    targets=$(basename -a ~/services/*/)
    if [[ -n "${prev}" && "${prev}" != "server" && ${prev} != -* ]]; then
        COMPREPLY=( $(compgen -W "${targets}" -- ${cur}) )
        return 0
    fi

    commands="init start restart stop update logs status"
    COMPREPLY=( $(compgen -W "${commands}" -- ${cur}) )
}

complete -F _server srv
