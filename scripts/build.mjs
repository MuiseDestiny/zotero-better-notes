import { build } from "esbuild";
import { zip } from "compressing";
import { join, basename } from "path";
import {
  existsSync,
  lstatSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  renameSync,
} from "fs";
import { env, exit } from "process";
import replaceInFile from "replace-in-file";
const { sync: replaceSync } = replaceInFile;
import details from "../package.json" assert { type: "json" };

const { name, author, description, homepage, version, config } = details;

function copyFileSync(source, target) {
  var targetFile = target;

  // If target is a directory, a new file with the same name will be created
  if (existsSync(target)) {
    if (lstatSync(target).isDirectory()) {
      targetFile = join(target, basename(source));
    }
  }

  writeFileSync(targetFile, readFileSync(source));
}

function copyFolderRecursiveSync(source, target) {
  var files = [];

  // Check if folder needs to be created or integrated
  var targetFolder = join(target, basename(source));
  if (!existsSync(targetFolder)) {
    mkdirSync(targetFolder);
  }

  // Copy
  if (lstatSync(source).isDirectory()) {
    files = readdirSync(source);
    files.forEach(function (file) {
      var curSource = join(source, file);
      if (lstatSync(curSource).isDirectory()) {
        copyFolderRecursiveSync(curSource, targetFolder);
      } else {
        copyFileSync(curSource, targetFolder);
      }
    });
  }
}

function clearFolder(target) {
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }

  mkdirSync(target, { recursive: true });
}

function dateFormat(fmt, date) {
  let ret;
  const opt = {
    "Y+": date.getFullYear().toString(),
    "m+": (date.getMonth() + 1).toString(),
    "d+": date.getDate().toString(),
    "H+": date.getHours().toString(),
    "M+": date.getMinutes().toString(),
    "S+": date.getSeconds().toString(),
  };
  for (let k in opt) {
    ret = new RegExp("(" + k + ")").exec(fmt);
    if (ret) {
      fmt = fmt.replace(
        ret[1],
        ret[1].length == 1 ? opt[k] : opt[k].padStart(ret[1].length, "0")
      );
    }
  }
  return fmt;
}

async function main() {
  const t = new Date();
  const buildTime = dateFormat("YYYY-mm-dd HH:MM:SS", t);
  const buildDir = "builds";

  console.log(
    `[Build] BUILD_DIR=${buildDir}, VERSION=${version}, BUILD_TIME=${buildTime}, ENV=${[
      env.NODE_ENV,
    ]}`
  );

  clearFolder(buildDir);

  copyFolderRecursiveSync("addon", buildDir);

  copyFileSync("update-template.json", "update.json");
  copyFileSync("update-template.rdf", "update.rdf");

  await build({
    entryPoints: ["src/index.ts"],
    define: {
      __env__: `"${env.NODE_ENV}"`,
    },
    bundle: true,
    outfile: join(buildDir, "addon/chrome/content/scripts/index.js"),
    // Don't turn minify on
    // minify: true,
    target: ["firefox60"],
  }).catch(() => exit(1));

  await build({
    entryPoints: ["src/extras/editorScript.ts"],
    bundle: true,
    outfile: join(buildDir, "addon/chrome/content/scripts/editorScript.js"),
    target: ["firefox60"],
  }).catch(() => exit(1));

  await build({
    entryPoints: ["src/extras/docxWorker.ts"],
    bundle: true,
    outfile: join(buildDir, "addon/chrome/content/scripts/docxWorker.js"),
    target: ["firefox60"],
  }).catch(() => exit(1));

  console.log("[Build] Run esbuild OK");

  const replaceFrom = [
    /__author__/g,
    /__description__/g,
    /__homepage__/g,
    /__buildVersion__/g,
    /__buildTime__/g,
  ];

  const replaceTo = [author, description, homepage, version, buildTime];

  replaceFrom.push(
    ...Object.keys(config).map((k) => new RegExp(`__${k}__`, "g"))
  );
  replaceTo.push(...Object.values(config));

  const optionsAddon = {
    files: [
      join(buildDir, "**/*.html"),
      join(buildDir, "**/*.xhtml"),
      join(buildDir, "**/*.json"),
      join(buildDir, "addon/prefs.js"),
      join(buildDir, "addon/bootstrap.js"),
      "update.json",
      "update.rdf",
    ],
    from: replaceFrom,
    to: replaceTo,
    countMatches: true,
  };

  const replaceResult = replaceSync(optionsAddon);
  console.log(
    "[Build] Run replace in ",
    replaceResult
      .filter((f) => f.hasChanged)
      .map((f) => `${f.file} : ${f.numReplacements} / ${f.numMatches}`)
  );

  console.log("[Build] Replace OK");

  // Walk the builds/addon/locale folder's sub folders and rename *.ftl to addonRef-*.ftl
  const localeDir = join(buildDir, "addon/locale");
  const localeFolders = readdirSync(localeDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  for (const localeSubFolder of localeFolders) {
    const localeSubDir = join(localeDir, localeSubFolder);
    const localeSubFiles = readdirSync(localeSubDir, {
      withFileTypes: true,
    })
      .filter((dirent) => dirent.isFile())
      .map((dirent) => dirent.name);

    for (const localeSubFile of localeSubFiles) {
      if (localeSubFile.endsWith(".ftl")) {
        renameSync(
          join(localeSubDir, localeSubFile),
          join(localeSubDir, `${config.addonRef}-${localeSubFile}`)
        );
      }
    }
  }

  console.log("[Build] Addon prepare OK");

  zip.compressDir(join(buildDir, "addon"), join(buildDir, `${name}.xpi`), {
    ignoreBase: true,
  });

  console.log("[Build] Addon pack OK");
  console.log(
    `[Build] Finished in ${(new Date().getTime() - t.getTime()) / 1000} s.`
  );
}

main().catch((err) => {
  console.log(err);
  exit(1);
});
