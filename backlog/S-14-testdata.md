# S-14 – Testdata: varianten, Wmo en generator

## Status

Gereed (02-10-2026). Komt uit de actielijst teststekker: TS-15, TS-16.

## Gebouwd

- `scripts/genereer-testdata.js` (`npm run data:genereer`): deterministische, fictieve datasets per seed; grote sets komen in `runtime/data/` en niet in git.
- `data/sociaal-domein-varianten.csv` (60 records, alle randgevallen) en `data/wmo-zaken.csv` (120 records, eigen id-reeks). De standaarddataset is ongewijzigd. Een test bewaakt dat de bestanden overeenkomen met de generator.
- Selecties in eindstatus worden bevroren in het geheugen gehouden: pagineren van 67.208 kandidaten ging van 20,7 s naar 0,2 s.
