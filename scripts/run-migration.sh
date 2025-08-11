#!/bin/bash

# PISOWifi Coin Slots Migration Script
# Run this on your Orange Pi to set up the coin slots system

echo "🚀 PISOWifi Coin Slots & Queues Migration"
echo "========================================="
echo ""

# Database connection details
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="pisowifi"
DB_USER="pisowifi_user"
DB_PASS="admin123"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "📊 Database Configuration:"
echo "  Host: $DB_HOST:$DB_PORT"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo ""

# Check if PostgreSQL is running
echo "🔍 Checking PostgreSQL status..."
if systemctl is-active --quiet postgresql; then
    echo -e "  ${GREEN}✅ PostgreSQL is running${NC}"
else
    echo -e "  ${YELLOW}⚠️  PostgreSQL is not running. Starting it...${NC}"
    sudo systemctl start postgresql
    sleep 2
fi
echo ""

# Set PGPASSWORD to avoid password prompt
export PGPASSWORD=$DB_PASS

# Check if we can connect to the database
echo "🔗 Testing database connection..."
if psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c '\q' 2>/dev/null; then
    echo -e "  ${GREEN}✅ Database connection successful${NC}"
else
    echo -e "  ${RED}❌ Cannot connect to database${NC}"
    echo ""
    echo "Troubleshooting steps:"
    echo "1. Check if PostgreSQL is installed: sudo apt-get install postgresql"
    echo "2. Check if database exists: sudo -u postgres psql -c '\l'"
    echo "3. Create database if needed:"
    echo "   sudo -u postgres psql -c \"CREATE DATABASE pisowifi;\""
    echo "   sudo -u postgres psql -c \"CREATE USER pisowifi_user WITH PASSWORD 'admin123';\""
    echo "   sudo -u postgres psql -c \"GRANT ALL PRIVILEGES ON DATABASE pisowifi TO pisowifi_user;\""
    exit 1
fi
echo ""

# Run the migration
echo "🚀 Running migration..."
echo ""

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Run the SQL file
if [ -f "$SCRIPT_DIR/coin-slots-migration.sql" ]; then
    psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$SCRIPT_DIR/coin-slots-migration.sql" 2>&1 | while IFS= read -r line; do
        if [[ $line == *"ERROR"* ]]; then
            echo -e "  ${RED}❌ $line${NC}"
        elif [[ $line == *"already exists"* ]]; then
            echo -e "  ${YELLOW}⚠️  $line${NC}"
        elif [[ $line == *"CREATE"* ]] || [[ $line == *"INSERT"* ]]; then
            echo -e "  ${GREEN}✅ $line${NC}"
        else
            echo "  $line"
        fi
    done
else
    echo -e "  ${RED}❌ Migration file not found: $SCRIPT_DIR/coin-slots-migration.sql${NC}"
    exit 1
fi
echo ""

# Verify the migration
echo "🔍 Verifying migration..."
echo ""

# Check if tables exist
echo "📊 Checking tables..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "
    SELECT '  ✅ ' || table_name || ' table created'
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name IN ('coin_slots', 'coin_queues');
"

# Check coin slots
echo ""
echo "🪙 Coin slots status:"
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "
    SELECT '  Slot ' || slot_number || ': ' || status
    FROM coin_slots
    ORDER BY slot_number;
"

echo ""
echo -e "${GREEN}✨ Migration completed successfully!${NC}"
echo ""
echo "📌 Next steps:"
echo "  1. Restart the server: npm start"
echo "  2. Access admin panel: http://<your-ip>:3000/admin/coin-slots"
echo "  3. Test portal: http://<your-ip>:3000/portal"
echo ""

# Unset the password variable
unset PGPASSWORD