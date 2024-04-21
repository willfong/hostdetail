aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin 742334901973.dkr.ecr.ap-southeast-1.amazonaws.com
docker build -t hostdetail .
echo "Commit Hash: $(git rev-parse --short HEAD)" && docker tag hostdetail:latest 742334901973.dkr.ecr.ap-southeast-1.amazonaws.com/hostdetail:$(git rev-parse --short HEAD) && docker push 742334901973.dkr.ecr.ap-southeast-1.amazonaws.com/hostdetail:$(git rev-parse --short HEAD)
docker tag 742334901973.dkr.ecr.ap-southeast-1.amazonaws.com/hostdetail:$(git rev-parse --short HEAD) 742334901973.dkr.ecr.ap-southeast-1.amazonaws.com/hostdetail:production
docker push 742334901973.dkr.ecr.ap-southeast-1.amazonaws.com/hostdetail:production
