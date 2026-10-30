'use strict';

const fs = require('fs/promises');

async function main() {
  const [jobPath, outputPath] = process.argv.slice(2);
  const { kind, input } = JSON.parse(await fs.readFile(jobPath, 'utf8'));
  let image;
  switch (kind) {
    case 'table': image = await require('../../../utils/generateBomberXLocoLiveTableImage').generateBomberXLocoLiveTableImage(input); break;
    case 'matches': image = await require('../../../utils/generateBomberXLocoMatchesImage').generateBomberXLocoMatchesImage(input); break;
    case 'ko': image = await require('../../../utils/ko-image-renderer').renderKoImage(input); break;
    case 'ceremony': image = await require('../ceremony/bomber-x-loco-ceremony').renderBomberXLocoCeremonyImage(input); break;
    case 'tott': image = await require('../../../utils/team-of-the-tournament-renderer').renderTeamOfTheTournament(input); break;
    case 'awards': image = await require('../../../utils/special-awards-renderer').renderSpecialAwards(input); break;
    default: throw new Error(`Unbekannter Grafiktest: ${kind}`);
  }
  await fs.writeFile(outputPath, Buffer.isBuffer(image) ? image : image.buffer);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { main };
