const LINE_FLOOR_MAPPINGS_PROPERTY = 'LINE_FLOOR_MAPPINGS';
const LINE_FLOOR_SECRET_PROPERTY = 'LINE_FLOOR_CONFIG_SECRET';

function doPost(event) {
  try {
    const request = JSON.parse(event.postData.contents);
    const properties = PropertiesService.getScriptProperties();
    const expectedSecret = properties.getProperty(LINE_FLOOR_SECRET_PROPERTY);
    if (!expectedSecret || request.secret !== expectedSecret) {
      return respond({ success: false, message: 'Unauthorized request.' });
    }

    if (request.action === 'read') {
      const saved = properties.getProperty(LINE_FLOOR_MAPPINGS_PROPERTY);
      return respond({ success: true, mappings: saved ? JSON.parse(saved) : [] });
    }

    if (request.action !== 'save') {
      return respond({ success: false, message: 'Unsupported action.' });
    }

    const validation = validateMappings(request.mappings);
    if (!validation.valid) {
      return respond({ success: false, message: validation.message });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      properties.setProperty(LINE_FLOOR_MAPPINGS_PROPERTY, JSON.stringify(validation.mappings));
    } finally {
      lock.releaseLock();
    }
    return respond({ success: true, mappings: validation.mappings });
  } catch (error) {
    return respond({ success: false, message: 'Invalid request.' });
  }
}

function validateMappings(mappings) {
  if (!Array.isArray(mappings) || mappings.length === 0 || mappings.length > 150) {
    return { valid: false, message: 'Mapping must contain 1 to 150 lines.' };
  }

  const seen = new Set();
  const normalized = [];
  for (const item of mappings) {
    const line = String(item && item.line || '').trim().toUpperCase();
    const lantai = Number(item && item.lantai);
    if (!/^[A-Z0-9][A-Z0-9 ._-]{0,29}$/.test(line) || ![1, 2, 3].includes(lantai)) {
      return { valid: false, message: 'Invalid line name or floor.' };
    }
    if (seen.has(line)) {
      return { valid: false, message: 'Duplicate line names are not allowed.' };
    }
    seen.add(line);
    normalized.push({ line: line, lantai: lantai });
  }
  return { valid: true, mappings: normalized };
}

function respond(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
