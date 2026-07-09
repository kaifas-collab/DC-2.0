#!/bin/bash

echo "=========================================="
echo "System Compatibility Check"
echo "Ubuntu 18.04 Requirements"
echo "=========================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

# Check Ubuntu version
echo "Checking Ubuntu version..."
if [ -f /etc/os-release ]; then
    . /etc/os-release
    echo "  OS: $NAME $VERSION"
    if [[ "$VERSION_ID" == "18.04" ]]; then
        echo -e "  ${GREEN}✓${NC} Ubuntu 18.04 detected"
    elif [[ "$VERSION_ID" > "18.04" ]]; then
        echo -e "  ${GREEN}✓${NC} Ubuntu $VERSION_ID (newer than 18.04, should work)"
    else
        echo -e "  ${YELLOW}⚠${NC} Ubuntu $VERSION_ID (older than 18.04, may have issues)"
        WARNINGS=$((WARNINGS+1))
    fi
else
    echo -e "  ${YELLOW}⚠${NC} Could not detect Ubuntu version"
    WARNINGS=$((WARNINGS+1))
fi
echo ""

# Check Node.js
echo "Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    NODE_MAJOR=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    echo "  Installed: $NODE_VERSION"
    
    if [ "$NODE_MAJOR" -ge 16 ]; then
        echo -e "  ${GREEN}✓${NC} Node.js version is compatible (>= 16.14.0)"
    else
        echo -e "  ${RED}✗${NC} Node.js version is too old (need >= 16.14.0)"
        echo "  Run: curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -"
        echo "       sudo apt-get install -y nodejs"
        ERRORS=$((ERRORS+1))
    fi
else
    echo -e "  ${RED}✗${NC} Node.js is not installed"
    echo "  Run: curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -"
    echo "       sudo apt-get install -y nodejs"
    ERRORS=$((ERRORS+1))
fi
echo ""

# Check npm
echo "Checking npm..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    NPM_MAJOR=$(npm --version | cut -d'.' -f1)
    echo "  Installed: v$NPM_VERSION"
    
    if [ "$NPM_MAJOR" -ge 8 ]; then
        echo -e "  ${GREEN}✓${NC} npm version is compatible (>= 8.0.0)"
    else
        echo -e "  ${YELLOW}⚠${NC} npm version is old (recommended >= 8.0.0)"
        echo "  Run: sudo npm install -g npm@latest"
        WARNINGS=$((WARNINGS+1))
    fi
else
    echo -e "  ${RED}✗${NC} npm is not installed"
    ERRORS=$((ERRORS+1))
fi
echo ""

# Check build-essential
echo "Checking build tools..."
if dpkg -l | grep -q build-essential; then
    echo -e "  ${GREEN}✓${NC} build-essential is installed"
else
    echo -e "  ${YELLOW}⚠${NC} build-essential is not installed"
    echo "  Run: sudo apt-get install -y build-essential"
    WARNINGS=$((WARNINGS+1))
fi
echo ""

# Check Python (needed for node-gyp)
echo "Checking Python..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo "  Installed: $PYTHON_VERSION"
    echo -e "  ${GREEN}✓${NC} Python 3 is available"
elif command -v python &> /dev/null; then
    PYTHON_VERSION=$(python --version)
    echo "  Installed: $PYTHON_VERSION"
    echo -e "  ${GREEN}✓${NC} Python is available"
else
    echo -e "  ${YELLOW}⚠${NC} Python is not installed"
    echo "  Run: sudo apt-get install -y python3"
    WARNINGS=$((WARNINGS+1))
fi
echo ""

# Check available disk space
echo "Checking disk space..."
AVAILABLE=$(df -h . | awk 'NR==2 {print $4}' | sed 's/G//')
if (( $(echo "$AVAILABLE > 1" | bc -l) )); then
    echo -e "  ${GREEN}✓${NC} Sufficient disk space available (${AVAILABLE}G free)"
else
    echo -e "  ${YELLOW}⚠${NC} Low disk space (${AVAILABLE}G free, recommended > 1GB)"
    WARNINGS=$((WARNINGS+1))
fi
echo ""

# Check RAM
echo "Checking RAM..."
TOTAL_RAM=$(free -m | awk 'NR==2 {print $2}')
if [ "$TOTAL_RAM" -ge 2000 ]; then
    echo -e "  ${GREEN}✓${NC} Sufficient RAM (${TOTAL_RAM}MB total)"
else
    echo -e "  ${YELLOW}⚠${NC} Low RAM (${TOTAL_RAM}MB total, recommended >= 2GB)"
    WARNINGS=$((WARNINGS+1))
fi
echo ""

# Summary
echo "=========================================="
echo "Summary"
echo "=========================================="
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo "You can proceed with:"
    echo "  npm install"
    echo "  npm run dev"
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ $WARNINGS warning(s) found${NC}"
    echo ""
    echo "You can proceed but some features may not work optimally."
    echo "  npm install"
    echo "  npm run dev"
else
    echo -e "${RED}✗ $ERRORS error(s) and $WARNINGS warning(s) found${NC}"
    echo ""
    echo "Please fix the errors above before proceeding."
    exit 1
fi
echo ""
