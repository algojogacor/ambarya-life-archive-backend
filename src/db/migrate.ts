import db from './database';

export const runMigrations = async () => {
  const migrations = [
    // Musik columns
    `ALTER TABLE entries ADD COLUMN music_title TEXT`,
    `ALTER TABLE entries ADD COLUMN music_artist TEXT`,
    `ALTER TABLE entries ADD COLUMN music_album_art TEXT`,
    `ALTER TABLE entries ADD COLUMN music_preview_url TEXT`,
    `ALTER TABLE entries ADD COLUMN music_itunes_url TEXT`,
    // Step count / activity
    `ALTER TABLE entries ADD COLUMN step_count INTEGER`,
    // Energy level
    `ALTER TABLE entries ADD COLUMN energy_level INTEGER`,
    // Sleep hours
    `ALTER TABLE entries ADD COLUMN sleep_hours REAL`,
  ];

  for (const sql of migrations) {
    try {
      await db.execute(sql);
      console.log(`✅ Migration OK: ${sql.substring(0, 50)}...`);
    } catch (e: any) {
      // Kalau kolom sudah ada, skip
      if (e.message?.includes('duplicate column') || e.message?.includes('already exists')) {
        console.log(`⏭️  Skip (already exists): ${sql.substring(0, 50)}...`);
      } else {
        console.error(`❌ Migration failed: ${sql}`, e.message);
      }
    }
  }

  console.log('✅ All migrations done');
};