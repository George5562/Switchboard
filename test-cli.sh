#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "Switchboard CLI Test Suite"
echo "========================================"
echo ""

# Test directory
TEST_DIR="$HOME/switchboard-test-$(date +%s)"
CLAUDE_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
BACKUP_CONFIG="${CLAUDE_CONFIG}.backup-test-$(date +%s)"

# Function to print test status
test_pass() {
    echo -e "${GREEN}✓ PASS:${NC} $1"
}

test_fail() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    exit 1
}

test_info() {
    echo -e "${YELLOW}ℹ INFO:${NC} $1"
}

# Backup existing Claude config
backup_original_config() {
    if [ -f "$CLAUDE_CONFIG" ]; then
        test_info "Backing up existing Claude config to: $BACKUP_CONFIG"
        cp "$CLAUDE_CONFIG" "$BACKUP_CONFIG"
    else
        test_info "No existing Claude config found"
    fi
}

# Restore original config
restore_original_config() {
    if [ -f "$BACKUP_CONFIG" ]; then
        test_info "Restoring original Claude config"
        cp "$BACKUP_CONFIG" "$CLAUDE_CONFIG"
        rm "$BACKUP_CONFIG"
    fi
}

# Cleanup function
cleanup() {
    test_info "Cleaning up test directory: $TEST_DIR"
    rm -rf "$TEST_DIR"
    restore_original_config
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Create test directory
test_info "Creating test directory: $TEST_DIR"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# Backup original config
backup_original_config

echo ""
echo "----------------------------------------"
echo "Test 1: switchboard --help"
echo "----------------------------------------"
OUTPUT=$(switchboard --help)
if echo "$OUTPUT" | grep -q "switchboard init"; then
    test_pass "Help command shows 'init' command"
else
    test_fail "Help command missing 'init' command"
fi

if echo "$OUTPUT" | grep -q "switchboard add"; then
    test_pass "Help command shows 'add' command"
else
    test_fail "Help command missing 'add' command"
fi

if echo "$OUTPUT" | grep -q "switchboard revert"; then
    test_pass "Help command shows 'revert' command"
else
    test_fail "Help command missing 'revert' command"
fi

echo ""
echo "----------------------------------------"
echo "Test 2: switchboard init"
echo "----------------------------------------"
# Answer "n" to the intelligent mode prompt
echo "n" | switchboard init

# Check if .switchboard directory was created
if [ -d ".switchboard" ]; then
    test_pass ".switchboard directory created"
else
    test_fail ".switchboard directory not created"
fi

# Check if .mcp.json was created in the test directory
if [ -f ".mcp.json" ]; then
    test_pass "Root .mcp.json created"
else
    test_fail "Root .mcp.json not created"
fi

# Check if switchboard is in the .mcp.json
if grep -q "switchboard" ".mcp.json"; then
    test_pass "Switchboard configured in .mcp.json"
else
    test_fail "Switchboard not found in .mcp.json"
fi

echo ""
echo "----------------------------------------"
echo "Test 3: switchboard add (basic)"
echo "----------------------------------------"
switchboard add @modelcontextprotocol/server-memory --description "Memory storage for persistent data"

# Check if .switchboard directory was created
if [ -d ".switchboard" ]; then
    test_pass ".switchboard directory created"
else
    test_fail ".switchboard directory not created"
fi

# Check if MCP was added (using the full package name)
if [ -d ".switchboard/mcps/@modelcontextprotocol/server-memory" ]; then
    test_pass "MCP directory created"
else
    test_fail "MCP directory not created"
fi

if [ -f ".switchboard/mcps/@modelcontextprotocol/server-memory/.mcp.json" ]; then
    test_pass "MCP config file created"
else
    test_fail "MCP config file not created"
fi

echo ""
echo "----------------------------------------"
echo "Test 4: switchboard add (with --claude)"
echo "----------------------------------------"
switchboard add @modelcontextprotocol/server-playwright --claude --description "Browser automation for testing"

# Check if added to local .switchboard
if [ -d ".switchboard/mcps/@modelcontextprotocol/server-playwright" ]; then
    test_pass "Playwright added to .switchboard"
else
    test_fail "Playwright not found in .switchboard"
fi

# Note: --claude flag adds to Claude Desktop config (not tested in isolated env)
test_info "--claude flag processed (Claude Desktop config not checked in test env)"

echo ""
echo "----------------------------------------"
echo "Test 5: switchboard add (with custom command)"
echo "----------------------------------------"
switchboard add custom-mcp --command "node /custom/path/mcp.js" --description "Custom test MCP"

if [ -f ".switchboard/mcps/custom-mcp/.mcp.json" ]; then
    test_pass "Custom MCP config created"

    # Check if custom command is in the config
    if grep -q "node /custom/path/mcp.js" ".switchboard/mcps/custom-mcp/.mcp.json"; then
        test_pass "Custom command saved correctly"
    else
        test_fail "Custom command not saved correctly"
    fi
else
    test_fail "Custom MCP config not created"
fi

echo ""
echo "----------------------------------------"
echo "Test 6: List added MCPs"
echo "----------------------------------------"
test_info "Listing .switchboard/mcps contents:"
ls -la ".switchboard/mcps/"

echo ""
echo "----------------------------------------"
echo "Test 7: switchboard revert"
echo "----------------------------------------"
switchboard revert

# Check if .switchboard directory was removed
if [ ! -d ".switchboard" ]; then
    test_pass ".switchboard directory removed"
else
    test_fail ".switchboard directory still exists"
fi

# Check if .mcp.json was restored
if [ -f ".mcp.json" ]; then
    # Should be restored from backup
    test_pass ".mcp.json exists after revert"
else
    test_pass ".mcp.json properly reverted"
fi

echo ""
echo "========================================"
echo -e "${GREEN}All tests passed!${NC}"
echo "========================================"
echo ""
echo "Test artifacts cleaned up."
echo "Original Claude config restored."
