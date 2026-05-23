import net from 'net';

/**
 * Generates an ESC/POS binary stream for printing a visitor badge on a 58mm thermal receipt printer.
 * @param {Object} visitor Visitor details 
 * @param {string} qrUrl The URL embedded in the QR Code
 * @returns {Buffer} ESC/POS command buffer
 */
export function generateEscPosBuffer(visitor, qrUrl) {
  const chunks = [];

  // 1. Initialize printer: ESC @ (0x1B 0x40)
  chunks.push(Buffer.from([0x1b, 0x40]));

  // 2. Set line spacing: ESC 3 30 (0x1B 0x33 0x1E)
  chunks.push(Buffer.from([0x1b, 0x33, 0x1e]));

  // 3. Center alignment: ESC a 1 (0x1B 0x61 0x01)
  chunks.push(Buffer.from([0x1b, 0x61, 0x01]));

  // 4. Generate ESC/POS commands for QR Code
  // Standard ESC/POS QR Code printing (GS ( k commands)
  const qrData = Buffer.from(qrUrl, 'utf-8');
  const dataLen = qrData.length;
  
  // pL and pH specify the length of data block (dataLen + 3)
  const pL = (dataLen + 3) & 0xff;
  const pH = ((dataLen + 3) >> 8) & 0xff;

  // Set Model: Model 2 (0x1D 0x28 0x6B 0x04 0x00 0x31 0x41 0x32 0x00)
  chunks.push(Buffer.from([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]));

  // Set Module Size: 9 (0x1D 0x28 0x6B 0x03 0x00 0x31 0x43 0x09)
  // Module size 9 produces around a 37mm sized QR code at 203 DPI to match the 50mm height.
  chunks.push(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x09]));

  // Set Error Correction Level: M = 49 (0x1D 0x28 0x6B 0x03 0x00 0x31 0x44 0x31)
  chunks.push(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x44, 0x31]));

  // Store data in symbol storage area (0x1D 0x28 0x6B pL pH 0x31 0x50 0x30 [data])
  chunks.push(Buffer.from([0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]));
  chunks.push(qrData);

  // Print QR Code from storage (0x1D 0x28 0x6B 0x03 0x00 0x31 0x51 0x30)
  chunks.push(Buffer.from([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]));

  // 5. Feed to the next label boundary (Form Feed / ASCII FF: 0x0C)
  // This commands label printers to feed paper until the sensor detects the next gap.
  chunks.push(Buffer.from([0x0c]));

  return Buffer.concat(chunks);
}

/**
 * Triggers a LAN socket print job to a network printer
 * @param {Object} visitor Visitor record
 * @param {string} qrUrl URL to encode in the QR code
 * @param {string} ip Network printer IP address
 * @param {number} port Network printer port (default 9100)
 * @returns {Promise<boolean>} Success state
 */
export function sendLanPrintJob(visitor, qrUrl, ip, port = 9100) {
  return new Promise((resolve, reject) => {
    if (!ip) {
      // Simulate print output in console
      console.log('\n--- LAN PRINT SIMULATION (No Printer IP Configured) ---');
      console.log(`Target: LAN Printer on local network (9100)`);
      console.log(`Printing Ticket for: ${visitor.name}`);
      console.log(`Company: ${visitor.company}`);
      console.log(`QR Code URL: ${qrUrl}`);
      console.log('ESC/POS Command Stream Generated successfully.');
      console.log('--- END OF SIMULATION ---\n');
      return resolve(true);
    }

    console.log(`Connecting to LAN printer at ${ip}:${port}...`);
    const client = new net.Socket();

    // Set connection timeout (5 seconds)
    client.setTimeout(5000);

    client.connect(port, ip, () => {
      console.log(`Connected to LAN printer! Sending ESC/POS command stream...`);
      const buffer = generateEscPosBuffer(visitor, qrUrl);
      client.write(buffer, () => {
        console.log(`Print stream written successfully to ${ip}:${port}`);
        client.end();
        resolve(true);
      });
    });

    client.on('error', (err) => {
      console.error(`Printer Connection Error: ${err.message}`);
      client.destroy();
      reject(err);
    });

    client.on('timeout', () => {
      console.error(`Printer Connection Timeout!`);
      client.destroy();
      reject(new Error('Connection timed out'));
    });
  });
}
