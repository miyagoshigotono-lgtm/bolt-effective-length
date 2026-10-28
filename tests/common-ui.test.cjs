const { run } = require("./browser.test.cjs");
(async () => {
  for (const channel of ["chrome", "msedge"])
    console.log(await run(channel, true));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
