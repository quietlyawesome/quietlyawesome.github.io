import subprocess


class GitError(Exception):
    pass


def git(repo, *args):
    p = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if p.returncode:
        raise GitError(f"git {args[0]}: {(p.stderr or p.stdout).strip()}")
    return p.stdout


def check_identity(repo):
    p = subprocess.run(["git", "-C", str(repo), "config", "user.email"], capture_output=True, text=True)
    email = p.stdout.strip()
    if not email.endswith("@users.noreply.github.com"):
        raise GitError(
            "this clone would commit with an email that is not your GitHub no-reply address, and GitHub blocks that push.\n"
            f"Fix once: git -C {repo} config user.email <id>+<username>@users.noreply.github.com"
        )


def pull(repo):
    try:
        git(repo, "pull", "--ff-only", "--quiet")
    except GitError as e:
        raise GitError(f"{e}\nThe data repository history changed in a way that is not a simple fast-forward. Stop and check it before going on.") from None


def commit_push(repo, paths, message):
    git(repo, "add", "--", *paths)
    git(repo, "commit", "--quiet", "-m", message)
    try:
        git(repo, "push", "--quiet")
    except GitError:
        git(repo, "pull", "--rebase", "--quiet")
        git(repo, "push", "--quiet")
