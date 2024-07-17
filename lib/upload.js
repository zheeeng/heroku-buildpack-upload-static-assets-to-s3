const AWS = require('aws-sdk');
const glob = require('glob');
const path = require('path');
const fs = require('fs');
const _ = require('lodash');
const async = require('async');
const mimeTypes = require('mime-types');

function getEnvVariable(name) {
  const processEnv = process.env[name]

  if (processEnv) {
    return processEnv
  }

  const envFilePath = path.join(process.env.ENV_DIR, name)

  if (fs.existsSync(envFilePath)) {
    return fs.readFileSync(envFilePath, { encoding: 'utf8' });
  }

  console.error('Read environment variable ' + name + ' failed.');

  process.exit(0);
}

function main () {
  console.log('Static Uploader started.');

  const enabled = getEnvVariable('AWS_UPLOAD_ENABLED');

  if (enabled !== 'ENABLED') {
    console.error('Static Uploader is not enabled');
    return
  }

  // AWS.config.logger = process.stdout;
  AWS.config.maxRetries = 10;

  AWS.config.accessKeyId = getEnvVariable('AWS_ACCESS_KEY_ID');
  AWS.config.secretAccessKey = getEnvVariable('AWS_SECRET_ACCESS_KEY');
  AWS.config.region = getEnvVariable('AWS_DEFAULT_REGION');

  // bucket where static assets are uploaded to
  const AWS_STATIC_BUCKET_NAME = getEnvVariable('AWS_STATIC_BUCKET_NAME');
  // the source directory of static assets
  const AWS_STATIC_SOURCE_DIRECTORY = getEnvVariable('AWS_STATIC_SOURCE_DIRECTORY');
  // the prefix assigned to the path, can be used to configure routing rules in CDNs
  const AWS_STATIC_PREFIX = getEnvVariable('AWS_STATIC_PREFIX');

  // the sha-1 or version supplied by heroku used to version builds in the path
  const SOURCE_VERSION = (process.env.SOURCE_VERSION || '').slice(0, 7);
  const BUILD_DIR = (process.env.BUILD_DIR || '');

  console.log('BUILD_DIR: ', BUILD_DIR);

  // location of public assets in the heroku build environment
  const PUBLIC_ASSETS_SOURCE_DIRECTORY = path.join(BUILD_DIR, AWS_STATIC_SOURCE_DIRECTORY);

  console.log('PUBLIC_ASSETS_SOURCE_DIRECTORY: ', PUBLIC_ASSETS_SOURCE_DIRECTORY);

  // uploaded files are prefixed with this to enable versioning
  const STATIC_PATH = path.join(AWS_STATIC_PREFIX, new Date().toISOString().split('T')[0], SOURCE_VERSION);

  console.log('STATIC_PATH: ', STATIC_PATH);

  glob(PUBLIC_ASSETS_SOURCE_DIRECTORY + '/**/*.*', {}, function(error, files) {
  
      if (error || !files) {
        return process.exit(1);
      }

      console.log('Files to Upload:', files.length);
      console.time('Upload Complete In');
  
      const yearInMs = 365 * 24 * 60 * 60000;
      const yearFromNow = Date.now() + yearInMs;

      const s3 = new AWS.S3();
      async.eachLimit(files, 16, function(file, callback) {

          const stat = fs.statSync(file);
          if (!stat.isFile()) {
            console.log('Not a file', file);
            return callback(null);
          }

          let contentType = mimeTypes.lookup(path.extname(file)) || null;
          if (!_.isString(contentType)) {
            console.warn('Unknown ContentType:', contentType, file);
            contentType = 'application/octet-stream';
          }

          s3.upload({
            ACL: 'public-read',
            Key: path.join(STATIC_PATH, file.replace(PUBLIC_ASSETS_SOURCE_DIRECTORY, '')),
            Body: fs.createReadStream(file),
            Bucket: AWS_STATIC_BUCKET_NAME,
            Expires: new Date(yearFromNow),
            CacheControl: 'public,max-age=' + yearInMs + ',smax-age=' + yearInMs,
            ContentType: contentType
          }, callback)

        },
        function onUploadComplete(error) {
          console.timeEnd('Upload Complete In');
  
          if (error) {
            console.error('Static Uploader failed to upload to S3');
            console.error(error);
            console.error('Exiting without error');
            process.exit(0);
          }

          const profiled = process.env.BUILD_DIR + '/.profile.d';
          fs.writeFileSync(
            path.join(profiled, '00-upload-static-files-to-s3-export-env.sh'),
            'echo EXPORTING STATIC ENV VARIABLES\n' +
            'export STATIC_SERVER=${STATIC_SERVER:-' + AWS_STATIC_BUCKET_NAME + '.s3.amazonaws.com' + '}\n' +
            'export STATIC_PATH=${STATIC_PATH:-/' + STATIC_PATH + '}\n',
            {encoding: 'utf8'}
          );

          process.exit(0);
        });
    }
  );
}

main()
