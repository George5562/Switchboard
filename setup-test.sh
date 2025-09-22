#!/bin/bash
# Switchboard Test Setup Script

echo "🔧 Setting up Switchboard testing environment..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Build Switchboard
echo -e "${YELLOW}Building Switchboard...${NC}"
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

# Step 2: Set up mock child for testing
echo -e "${YELLOW}Setting up mock child MCP...${NC}"
mkdir -p mcps
cp -r examples/mock-child mcps/ 2>/dev/null || true

# Step 3: Create a simple test MCP configuration
echo -e "${YELLOW}Creating additional test MCPs...${NC}"
mkdir -p mcps/test-tools
cat > mcps/test-tools/.mcp.json << 'EOF'
{
  "name": "test-tools",
  "description": "Test tools with many subtools",
  "command": {
    "cmd": "node",
    "args": ["index.js"]
  }
}
EOF

# Step 4: Link Switchboard globally
echo -e "${YELLOW}Installing Switchboard globally...${NC}"
npm link

# Verify installation
if command -v switchboard &> /dev/null; then
    echo -e "${GREEN}✅ Switchboard installed successfully${NC}"
    echo "📍 Location: $(which switchboard)"
else
    echo "⚠️  Switchboard not found in PATH, trying npm global install..."
    npm install -g .
fi

# Step 5: Create test area for filesystem MCP
echo -e "${YELLOW}Creating test area for filesystem operations...${NC}"
mkdir -p ~/Documents/test-area
echo "Hello from test area" > ~/Documents/test-area/test.txt
echo -e "${GREEN}✅ Test area created at ~/Documents/test-area${NC}"

# Step 6: Generate Claude Code config examples
echo -e "${YELLOW}Generating Claude Code configuration examples...${NC}"

cat > claude-code-config-direct.json << 'EOF'
{
  "mcps": {
    "mock": {
      "command": "node",
      "args": ["examples/mock-child/index.js"],
      "cwd": "$PWD"
    }
  }
}
EOF

cat > claude-code-config-switchboard.json << 'EOF'
{
  "mcps": {
    "switchboard": {
      "command": "switchboard",
      "args": [],
      "cwd": "$PWD"
    }
  }
}
EOF

# Replace $PWD with actual path
sed -i.bak "s|\$PWD|$PWD|g" claude-code-config-*.json
rm claude-code-config-*.json.bak 2>/dev/null || true

echo -e "${GREEN}✅ Configuration examples created${NC}"

# Step 7: Quick test
echo -e "${YELLOW}Running quick test...${NC}"
echo '{"jsonrpc":"2.0","method":"initialize","params":{"capabilities":{}},"id":1}' | switchboard > /tmp/test-output.json 2>/dev/null

if grep -q "switchboard" /tmp/test-output.json 2>/dev/null; then
    echo -e "${GREEN}✅ Switchboard responds to JSON-RPC${NC}"
else
    echo "⚠️  Switchboard may not be working correctly"
fi

# Step 8: Show next steps
echo ""
echo "========================================="
echo -e "${GREEN}Setup Complete!${NC}"
echo "========================================="
echo ""
echo "📋 Next steps:"
echo ""
echo "1. To test with Claude Code, add this to your Claude Code settings:"
echo "   $(cat claude-code-config-switchboard.json)"
echo ""
echo "2. To compare with direct MCP, use:"
echo "   $(cat claude-code-config-direct.json)"
echo ""
echo "3. Test commands you can run now:"
echo "   switchboard  # Starts the proxy"
echo "   npm test     # Run test suite"
echo ""
echo "4. In Claude Code:"
echo "   - Type: /context"
echo "   - Compare tool descriptions with and without Switchboard"
echo ""
echo "📁 Files created:"
echo "   - claude-code-config-direct.json"
echo "   - claude-code-config-switchboard.json"
echo "   - ~/Documents/test-area/test.txt"
echo ""