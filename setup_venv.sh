#!/bin/bash
# Virtual Environment Setup Script for Pepper Project (Linux/Mac)
# This creates an isolated Python environment for PC-side development

echo "========================================"
echo "Pepper Project - Virtual Environment Setup"
echo "========================================"
echo ""

# Check Python version
python3 --version
echo ""

# Create virtual environment
echo "[1/4] Creating virtual environment 'venv_pepper'..."
python3 -m venv venv_pepper
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to create virtual environment"
    echo "Make sure Python 3.6+ is installed"
    exit 1
fi
echo "Done!"
echo ""

# Activate virtual environment
echo "[2/4] Activating virtual environment..."
source venv_pepper/bin/activate
echo "Done!"
echo ""

# Upgrade pip
echo "[3/4] Upgrading pip..."
python -m pip install --upgrade pip
echo "Done!"
echo ""

# Install requirements
echo "[4/4] Installing dependencies from requirements-pc.txt..."
pip install -r requirements-pc.txt
echo "Done!"
echo ""

echo "========================================"
echo "Setup Complete!"
echo "========================================"
echo ""
echo "To activate the virtual environment in the future, run:"
echo "  source venv_pepper/bin/activate"
echo ""
echo "To deactivate, run:"
echo "  deactivate"
echo ""
