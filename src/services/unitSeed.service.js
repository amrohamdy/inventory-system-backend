const DEFAULT_UNITS = [
    ['Piece', 'pcs'],
    ['Unit', 'unit'],
    ['Dozen', 'dz'],
    ['Set', 'set'],
    ['Pair', 'pair'],
    ['Kilogram', 'kg'],
    ['Gram', 'g'],
    ['Liter', 'ltr'],
    ['Milliliter', 'ml'],
    ['Bottle', 'btl'],
    ['Can', 'can'],
    ['Carton', 'ctn'],
    ['Box', 'box'],
    ['Pack', 'pk'],
    ['Tray', 'try'],
    ['Bag', 'bag'],
    ['Gallon', 'gal'],
    ['Roll', 'roll'],
    ['Bucket', 'bkt'],
    ['Jerrycan', 'jcn'],
    ['Meter', 'm'],
    ['Square Meter', 'm2'],
    ['Sheet', 'sht'],
    ['Box 100pcs', 'bx100'],
    ['Person/Pax', 'pax'],
];

const seedDefaultUnitsForTenant = async (tx, tenantId) => {
    for (const [name, abbreviation] of DEFAULT_UNITS) {
        await tx.unit.upsert({
            where: {
                tenantId_name: {
                    tenantId,
                    name,
                },
            },
            update: {
                abbreviation,
                isActive: true,
            },
            create: {
                tenantId,
                name,
                abbreviation,
                isActive: true,
            },
        });
    }
};

module.exports = {
    DEFAULT_UNITS,
    seedDefaultUnitsForTenant,
};
