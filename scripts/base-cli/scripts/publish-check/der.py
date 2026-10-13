"""Strict, bounded DER reading for X.501 Names and SubjectPublicKeyInfo."""
SET, SEQUENCE, OID, BIT_STRING = 0x31, 0x30, 0x06, 0x03


def tlv(data, offset, end):
    """(tag, content start, content end) of one minimally encoded definite TLV."""
    if offset + 2 > end or data[offset] & 0x1f == 0x1f:
        return None
    start, length = offset + 2, data[offset + 1]
    if length & 0x80:
        count = length & 0x7f
        if not 1 <= count <= 3 or start + count > end or data[start] == 0:
            return None
        length = int.from_bytes(data[start:start + count], 'big')
        start += count
        if length < 0x80:
            return None
    return (data[offset], start, start + length) if start + length <= end else None


def rdn_values(data, offset, end):
    """End and attribute value spans of one RelativeDistinguishedName SET."""
    rdn = tlv(data, offset, end)
    if not rdn or rdn[0] != SET or rdn[1] == rdn[2]:
        return None
    values, cursor = [], rdn[1]
    while cursor < rdn[2]:
        attribute = tlv(data, cursor, rdn[2])
        if not attribute or attribute[0] != SEQUENCE:
            return None
        oid = tlv(data, attribute[1], attribute[2])
        value = oid and oid[0] == OID and oid[1] < oid[2] and tlv(data, oid[2], attribute[2])
        if not value or value[2] != attribute[2]:
            return None
        values.append((value[1], value[2]))
        cursor = attribute[2]
    return rdn[2], values


def names(data):
    """Every (start, end, value spans) RDNSequence content run, by each prefix."""
    offset = data.find(SET)
    while offset >= 0:
        cursor, values = offset, []
        while (rdn := rdn_values(data, cursor, len(data))):
            cursor = rdn[0]
            values += rdn[1]
            yield offset, cursor, tuple(values)
        offset = data.find(SET, offset + 1)


def public_keys(data):
    """Every (start, end) AlgorithmIdentifier + BIT STRING content run."""
    offset = data.find(SEQUENCE)
    while offset >= 0:
        algorithm = tlv(data, offset, len(data))
        if algorithm and algorithm[0] == SEQUENCE:
            key = tlv(data, algorithm[2], len(data))
            if key and key[0] == BIT_STRING:
                yield offset, key[2]
        offset = data.find(SEQUENCE, offset + 1)
