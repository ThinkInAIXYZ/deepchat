# PGlite Migration Troubleshooting Guide

## Common Issues and Solutions

### Migration Fails to Start

#### Issue: "Legacy databases not found"
**Symptoms**: Migration doesn't start, error message about missing databases

**Solutions**:
1. **Check Database Location**: Ensure your SQLite and DuckDB files are in the expected location
2. **File Permissions**: Verify DeepChat has read access to database files
3. **File Corruption**: Check if database files are corrupted using built-in validation
4. **Manual Location**: Use the manual database location option in settings

**Commands to Check**:
```bash
# Check file permissions (Linux/Mac)
ls -la ~/.deepchat/databases/

# Check file integrity
file ~/.deepchat/databases/*.db
```

#### Issue: "Insufficient disk space"
**Symptoms**: Migration stops with disk space error

**Solutions**:
1. **Free Space**: Delete unnecessary files to create space
2. **Move Files**: Temporarily move large files to external storage
3. **Change Location**: Configure DeepChat to use a different drive with more space
4. **Clean Temp**: Clear system temporary files

**Space Requirements**:
- Minimum: 2x current database size
- Recommended: 3x current database size for safety

### Migration Progress Issues

#### Issue: Migration appears stuck
**Symptoms**: Progress bar doesn't move for extended periods

**Solutions**:
1. **Wait Patiently**: Large datasets can take time, especially vector data
2. **Check Logs**: Review migration logs for actual progress
3. **System Resources**: Ensure adequate RAM and CPU availability
4. **Background Tasks**: Pause other intensive applications

**Expected Times**:
- Conversations: ~1000 messages per minute
- Vector Data: ~100 embeddings per minute
- Large Files: Depends on disk I/O speed

#### Issue: Migration fails partway through
**Symptoms**: Error dialog appears during migration

**Solutions**:
1. **Check Error Type**: Review specific error message
2. **Retry Migration**: Use the retry option if available
3. **Incremental Mode**: Enable incremental migration for large datasets
4. **Contact Support**: Provide error logs for assistance

### Data Integrity Issues

#### Issue: "Data validation failed"
**Symptoms**: Migration completes but validation reports errors

**Solutions**:
1. **Review Validation Report**: Check which data failed validation
2. **Source Data Issues**: Verify original database integrity
3. **Retry Specific Tables**: Re-migrate only affected data
4. **Manual Verification**: Compare source and target data manually

**Validation Commands**:
```sql
-- Check conversation counts
SELECT COUNT(*) FROM conversations;

-- Check message relationships
SELECT COUNT(*) FROM messages WHERE parent_id NOT IN (SELECT msg_id FROM messages);

-- Check vector dimensions
SELECT DISTINCT array_length(embedding, 1) FROM knowledge_vectors;
```

#### Issue: Missing conversations or messages
**Symptoms**: Some data appears to be missing after migration

**Solutions**:
1. **Check Filters**: Ensure no filters are hiding data
2. **Verify Migration Logs**: Review what was actually migrated
3. **Database Corruption**: Check if source database was corrupted
4. **Restore from Backup**: Use backup restoration if needed

### Performance Issues

#### Issue: Slow migration performance
**Symptoms**: Migration takes much longer than expected

**Solutions**:
1. **Reduce Batch Size**: Configure smaller batch sizes for processing
2. **Disable Antivirus**: Temporarily disable real-time scanning
3. **Close Applications**: Free up system resources
4. **Use SSD**: Migrate to SSD storage if using HDD

**Performance Tuning**:
```javascript
// Migration configuration options
{
  batchSize: 100,        // Reduce for slower systems
  validateData: false,   // Disable for faster migration
  parallelTables: 1,     // Reduce concurrent operations
  memoryLimit: '1GB'     // Limit memory usage
}
```

#### Issue: High memory usage during migration
**Symptoms**: System becomes unresponsive, out of memory errors

**Solutions**:
1. **Reduce Batch Size**: Process smaller chunks of data
2. **Enable Streaming**: Use streaming mode for large datasets
3. **Increase Virtual Memory**: Configure larger page file/swap
4. **Close Other Apps**: Free up available RAM

### Vector Search Issues

#### Issue: Vector search not working after migration
**Symptoms**: Knowledge base searches return no results

**Solutions**:
1. **Check pgvector Extension**: Verify extension is loaded
2. **Rebuild Indexes**: Recreate vector indexes if needed
3. **Verify Embeddings**: Check that vector data was migrated correctly
4. **Update Search Configuration**: Adjust search parameters

**Diagnostic Queries**:
```sql
-- Check pgvector extension
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Check vector data
SELECT COUNT(*) FROM knowledge_vectors WHERE embedding IS NOT NULL;

-- Test vector search
SELECT * FROM knowledge_vectors ORDER BY embedding <-> '[0,1,0,...]' LIMIT 5;
```

### Backup and Recovery

#### Issue: Need to restore from backup
**Symptoms**: Migration failed and need to revert

**Solutions**:
1. **Locate Backups**: Find timestamped backup files
2. **Stop DeepChat**: Ensure application is closed
3. **Restore Files**: Copy backup files to original locations
4. **Verify Restoration**: Start DeepChat and verify data

**Backup Locations**:
- Windows: `%APPDATA%/DeepChat/backups/`
- macOS: `~/Library/Application Support/DeepChat/backups/`
- Linux: `~/.config/DeepChat/backups/`

#### Issue: Backup files are corrupted
**Symptoms**: Cannot restore from backup files

**Solutions**:
1. **Check Multiple Backups**: Try different backup timestamps
2. **Partial Recovery**: Extract what data is recoverable
3. **External Backups**: Use any external backups you created
4. **Data Recovery Tools**: Use specialized database recovery tools

### Platform-Specific Issues

#### Windows Issues

**Issue: Permission denied errors**
```
Error: EACCES: permission denied, open 'database.db'
```

**Solutions**:
1. Run DeepChat as Administrator
2. Check Windows Defender exclusions
3. Verify folder permissions
4. Disable UAC temporarily

#### macOS Issues

**Issue: Gatekeeper blocking migration**
```
Error: App is damaged and can't be opened
```

**Solutions**:
1. Allow app in Security & Privacy settings
2. Use `xattr -d com.apple.quarantine` command
3. Temporarily disable Gatekeeper
4. Re-download from official source

#### Linux Issues

**Issue: Missing dependencies**
```
Error: libpq.so.5: cannot open shared object file
```

**Solutions**:
1. Install PostgreSQL client libraries
2. Update system packages
3. Check LD_LIBRARY_PATH
4. Use AppImage version if available

### Advanced Troubleshooting

#### Enable Debug Logging

Add to your DeepChat configuration:
```json
{
  "migration": {
    "debugMode": true,
    "logLevel": "verbose",
    "logFile": "migration-debug.log"
  }
}
```

#### Manual Migration Steps

If automatic migration fails, you can perform manual steps:

1. **Export Data**: Use built-in export tools
2. **Clean Install**: Fresh DeepChat installation
3. **Import Data**: Use import tools for the exported data
4. **Verify Results**: Check all data is present

#### Database Repair

For corrupted databases:
```bash
# SQLite repair
sqlite3 database.db ".recover" > recovered.sql

# Import recovered data
sqlite3 new_database.db < recovered.sql
```

## Getting Help

### Log Files

Always include these files when seeking support:
- `migration.log` - Main migration log
- `error.log` - Error details
- `validation.log` - Data validation results
- `performance.log` - Performance metrics

### System Information

Provide this information:
- Operating System and version
- DeepChat version
- Database sizes
- Available disk space
- RAM amount
- Error messages (exact text)

### Support Channels

1. **Documentation**: Check all documentation first
2. **Community Forums**: Search existing discussions
3. **GitHub Issues**: Report bugs with logs
4. **Direct Support**: Contact support with detailed information

## Prevention

### Best Practices

1. **Regular Backups**: Create manual backups before major updates
2. **Disk Monitoring**: Keep adequate free space
3. **System Maintenance**: Keep OS and drivers updated
4. **Clean Environment**: Close unnecessary applications during migration
5. **Stable Power**: Use UPS for desktop systems

### Pre-Migration Checklist

- [ ] Backup databases manually
- [ ] Check available disk space (2x database size)
- [ ] Close other applications
- [ ] Ensure stable power supply
- [ ] Update system drivers
- [ ] Disable antivirus temporarily
- [ ] Note current database locations
- [ ] Record current data counts for verification