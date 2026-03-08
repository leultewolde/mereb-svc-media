secret:
  enabled: true
  nameOverride: {{SECRET_NAME}}
  stringData:
    DATABASE_URL: {{DATABASE_URL}}
    S3_ACCESS_KEY: {{S3_ACCESS_KEY}}
    S3_SECRET_KEY: {{S3_SECRET_KEY}}
    SPLUNK_HEC_TOKEN: {{SPLUNK_HEC_TOKEN}}
