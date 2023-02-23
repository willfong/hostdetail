# Host Detail

Simple Node/Express app for displaying host / IP address.

Find it at: https://hostdetail.net

## Getting Started

```
docker run --restart always -d --name hostdetail -p 5000:3000 wfong/hostdetail
```

## Deployment

1. Commit to GitHub
1. Dockerhub will automatically build
1. Run `yarn deploy` to have ECS pull
