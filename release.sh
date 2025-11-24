#!/bin/bash

# html-split-canvas Release Script
# Automates version tagging and triggering NuGet package publishing

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_usage() {
    echo -e "${BLUE}html-split-canvas Release Script${NC}"
    echo
    echo "Usage: ./release.sh [VERSION] [OPTIONS]"
    echo
    echo "Arguments:"
    echo "  VERSION     Semantic version (e.g., 1.0.0, 1.1.0)"
    echo "              If not provided, script will auto-increment patch"
    echo
    echo "Options:"
    echo "  -m, --message TEXT    Release notes/message (optional)"
    echo "  --patch               Auto-increment patch version (default)"
    echo "  --minor               Auto-increment minor version"
    echo "  --major               Auto-increment major version"
    echo "  --dry-run             Show what would be done without executing"
    echo "  -h, --help            Show this help message"
    echo
    echo "Examples:"
    echo "  ./release.sh 1.0.0                       # Release specific version"
    echo "  ./release.sh 1.0.0 -m \"Bug fixes\"       # With release notes"
    echo "  ./release.sh --patch -m \"New features\"  # Auto-increment patch"
    echo "  ./release.sh --dry-run                   # Preview next release"
}

print_error() {
    echo -e "${RED}Error: $1${NC}" >&2
}

print_success() {
    echo -e "${GREEN}$1${NC}"
}

print_info() {
    echo -e "${BLUE}$1${NC}"
}

# Get the latest version tag
get_latest_version() {
    git tag --sort=-version:refname | grep -E '^hdrsplit/[0-9]+\.[0-9]+\.[0-9]+$' | head -n1 | sed 's/^hdrsplit\///' || echo "1.0.0"
}

# Increment version
increment_version() {
    local version=$1
    local part=$2

    IFS='.' read -r -a parts <<< "$version"
    local major=${parts[0]:-1}
    local minor=${parts[1]:-0}
    local patch=${parts[2]:-0}

    case $part in
        "major")
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        "minor")
            minor=$((minor + 1))
            patch=0
            ;;
        "patch")
            patch=$((patch + 1))
            ;;
        *)
            print_error "Invalid version part: $part"
            exit 1
            ;;
    esac

    echo "$major.$minor.$patch"
}

# Parse arguments
VERSION=""
MESSAGE=""
INCREMENT="patch"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            print_usage
            exit 0
            ;;
        -m|--message)
            MESSAGE="$2"
            shift 2
            ;;
        --patch)
            INCREMENT="patch"
            shift
            ;;
        --minor)
            INCREMENT="minor"
            shift
            ;;
        --major)
            INCREMENT="major"
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -*)
            print_error "Unknown option: $1"
            print_usage
            exit 1
            ;;
        *)
            if [[ -z "$VERSION" ]]; then
                VERSION="$1"
            else
                print_error "Unexpected argument: $1"
                print_usage
                exit 1
            fi
            shift
            ;;
    esac
done

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not in a git repository"
    exit 1
fi

# Check if on master/main branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "master" && "$CURRENT_BRANCH" != "main" ]]; then
    print_error "Not on master/main branch (currently on: $CURRENT_BRANCH)"
    exit 1
fi

# Ensure working directory is clean
if [[ -n $(git status --porcelain) ]]; then
    print_error "Working directory is not clean. Commit or stash changes first."
    exit 1
fi

# Determine version
if [[ -z "$VERSION" ]]; then
    LATEST_VERSION=$(get_latest_version)
    VERSION=$(increment_version "$LATEST_VERSION" "$INCREMENT")
    print_info "Auto-incrementing $INCREMENT: $LATEST_VERSION -> $VERSION"
fi

# Validate version format (X.Y.Z)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    print_error "Invalid version format: $VERSION (expected X.Y.Z)"
    exit 1
fi

TAG="hdrsplit/$VERSION"

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
    print_error "Tag $TAG already exists"
    exit 1
fi

# Show what will be done
print_info "Preparing release:"
print_info "  Version: $VERSION"
print_info "  Tag: $TAG"
if [[ -n "$MESSAGE" ]]; then
    print_info "  Message: $MESSAGE"
fi

if $DRY_RUN; then
    print_info "\n[DRY RUN] Would create tag and push to origin"
    exit 0
fi

# Create and push tag
print_info "\nCreating tag..."
if [[ -n "$MESSAGE" ]]; then
    git tag -a "$TAG" -m "$MESSAGE"
else
    git tag "$TAG"
fi

print_info "Pushing tag to origin..."
git push origin "$TAG"

print_success "\n✓ Release $VERSION created successfully!"
print_info "GitHub Actions will now build and publish NuGet packages."
print_info "Monitor progress at: https://github.com/modelingevolution/html-split-canvas/actions"
