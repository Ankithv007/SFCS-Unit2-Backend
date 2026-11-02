pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
        timeout(time: 90, unit: 'MINUTES')
        skipDefaultCheckout(true)
    }

    environment {
        DOCKERHUB_CREDS = 'dockerhub-token'

        IMAGE_PREFIX       = 'ankithbv007/sfcs-unit2-backend'
        LOCAL_IMAGE_PREFIX = 'sfcs-unit2-backend'

        DEPLOY_HOST = '139.84.217.224'
        DEPLOY_DIR  = '/opt/sfcs-unit2'

        SSH_CREDENTIALS_ID = 'sfcs-production-ssh'

        BACKEND_SERVICES = 'backend-backend backend-inventory backend-login backend-pretest backend-qc-inspection backend-rrh backend-smt backend-vacuum-leak-test'
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm

                script {
                    env.GIT_COMMIT_FULL = sh(
                        script: 'git rev-parse HEAD',
                        returnStdout: true
                    ).trim()

                    env.IMAGE_TAG = env.GIT_COMMIT_FULL.take(12)
                }

                echo "Git commit: ${env.GIT_COMMIT_FULL}"
                echo "Docker image tag: ${env.IMAGE_TAG}"

                sh '''
                    set -eu

                    printf '%s' "$IMAGE_TAG" |
                        grep -Eq '^[0-9a-f]{12}$' || {
                            echo "ERROR: Invalid Git commit image tag."
                            exit 1
                        }

                    git rev-parse --verify HEAD

                    echo "Checkout successful."
                '''
            }
        }

        stage('Check Docker') {
            steps {
                sh '''
                    set -eu

                    docker --version
                    docker info >/dev/null

                    echo "Docker is available."
                '''
            }
        }

        stage('Build All Backend Images') {
            steps {
                sh '''
                    set -eu

                    for service in $BACKEND_SERVICES; do
                        echo "========================================"
                        echo "Building $service:$IMAGE_TAG"
                        echo "========================================"

                        if [ ! -f "$service/Dockerfile" ]; then
                            echo "ERROR: Dockerfile missing: $service/Dockerfile"
                            exit 1
                        fi

                        docker build \
                            --pull \
                            -t "${LOCAL_IMAGE_PREFIX}-${service}:${IMAGE_TAG}" \
                            -f "$service/Dockerfile" \
                            "$service/"
                    done

                    echo "All eight backend images built successfully."
                '''
            }
        }

        stage('Push Images to Docker Hub') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: "${DOCKERHUB_CREDS}",
                        usernameVariable: 'DOCKERHUB_USERNAME',
                        passwordVariable: 'DOCKERHUB_TOKEN'
                    )
                ]) {
                    sh '''
                        set -eu

                        DOCKER_CONFIG="$(mktemp -d)"
                        export DOCKER_CONFIG

                        trap 'docker logout >/dev/null 2>&1 || true; rm -rf "$DOCKER_CONFIG"' EXIT

                        echo "Logging in to Docker Hub..."

                        printf '%s' "$DOCKERHUB_TOKEN" |
                            docker login \
                                --username "$DOCKERHUB_USERNAME" \
                                --password-stdin

                        for service in $BACKEND_SERVICES; do
                            LOCAL_IMAGE="${LOCAL_IMAGE_PREFIX}-${service}:${IMAGE_TAG}"
                            REMOTE_IMAGE="${IMAGE_PREFIX}-${service}:${IMAGE_TAG}"

                            echo "Tagging $REMOTE_IMAGE"

                            docker tag "$LOCAL_IMAGE" "$REMOTE_IMAGE"

                            echo "Pushing $REMOTE_IMAGE"

                            docker push "$REMOTE_IMAGE"
                        done

                        echo "All eight images pushed successfully."
                    '''
                }
            }
        }

        stage('Verify Docker Hub Images') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: "${DOCKERHUB_CREDS}",
                        usernameVariable: 'DOCKERHUB_USERNAME',
                        passwordVariable: 'DOCKERHUB_TOKEN'
                    )
                ]) {
                    sh '''
                        set -eu

                        DOCKER_CONFIG="$(mktemp -d)"
                        export DOCKER_CONFIG

                        trap 'docker logout >/dev/null 2>&1 || true; rm -rf "$DOCKER_CONFIG"' EXIT

                        printf '%s' "$DOCKERHUB_TOKEN" |
                            docker login \
                                --username "$DOCKERHUB_USERNAME" \
                                --password-stdin

                        for service in $BACKEND_SERVICES; do
                            IMAGE="${IMAGE_PREFIX}-${service}:${IMAGE_TAG}"

                            echo "Verifying $IMAGE"

                            docker manifest inspect "$IMAGE" >/dev/null

                            echo "Verified: $IMAGE"
                        done

                        echo "All eight Docker Hub images verified."
                    '''
                }
            }
        }

        stage('Deploy to Production') {
            steps {
                withCredentials([
                    sshUserPrivateKey(
                        credentialsId: "${SSH_CREDENTIALS_ID}",
                        keyFileVariable: 'SSH_KEY',
                        usernameVariable: 'SSH_USER'
                    ),
                    usernamePassword(
                        credentialsId: "${DOCKERHUB_CREDS}",
                        usernameVariable: 'DOCKERHUB_USERNAME',
                        passwordVariable: 'DOCKERHUB_TOKEN'
                    )
                ]) {
                    sh '''
                        set -eu

                        echo "Connecting to production server..."

                        # Authenticate Docker Hub on the production server.
                        # This uses the server's Docker configuration.
                        printf '%s' "$DOCKERHUB_TOKEN" |
                            ssh \
                                -i "$SSH_KEY" \
                                -o StrictHostKeyChecking=accept-new \
                                -o ConnectTimeout=15 \
                                "$SSH_USER@$DEPLOY_HOST" \
                                "docker login --username '$DOCKERHUB_USERNAME' --password-stdin"

                        echo "Docker Hub login succeeded."

                        # Send the deployment script to the production server.
                        # IMPORTANT: REMOTE_SCRIPT closing marker must be at column 1.
                        ssh \
                            -i "$SSH_KEY" \
                            -o StrictHostKeyChecking=accept-new \
                            -o ConnectTimeout=15 \
                            "$SSH_USER@$DEPLOY_HOST" \
                            "DEPLOY_DIR='$DEPLOY_DIR' BACKEND_TAG='$IMAGE_TAG' bash -s" <<'REMOTE_SCRIPT'

set -Eeuo pipefail

cd "$DEPLOY_DIR"

echo "Deploy directory: $DEPLOY_DIR"
echo "New backend tag: $BACKEND_TAG"

if [ ! -f .env ]; then
    echo "ERROR: Production .env file not found."
    exit 1
fi

if ! printf '%s' "$BACKEND_TAG" | grep -Eq '^[0-9a-f]{12}$'; then
    echo "ERROR: Invalid image tag."
    exit 1
fi

# Back up .env before changing the backend image tag.
BACKUP_FILE="$(mktemp)"
cp .env "$BACKUP_FILE"

OLD_TAG="$(
    grep '^BACKEND_TAG=' .env |
    tail -n 1 |
    cut -d '=' -f 2- || true
)"

rollback() {
    STATUS=$?
    trap - ERR

    echo "ERROR: Deployment failed."
    echo "Restoring the previous .env file."

    cp "$BACKUP_FILE" .env

    if printf '%s' "$OLD_TAG" | grep -Eq '^[0-9a-f]{12}$'; then
        echo "Attempting rollback to backend tag: $OLD_TAG"

        export BACKEND_TAG="$OLD_TAG"

        if docker compose pull \
            backend-backend \
            backend-inventory \
            backend-login \
            backend-pretest \
            backend-qc-inspection \
            backend-rrh \
            backend-smt \
            backend-vacuum-leak-test; then

            docker compose up -d --no-deps \
                backend-backend \
                backend-inventory \
                backend-login \
                backend-pretest \
                backend-qc-inspection \
                backend-rrh \
                backend-smt \
                backend-vacuum-leak-test || true
        else
            echo "WARNING: Previous images could not be pulled."
        fi
    else
        echo "WARNING: No valid previous BACKEND_TAG was found."
        echo "Automatic rollback cannot be guaranteed."
    fi

    rm -f "$BACKUP_FILE"

    exit "$STATUS"
}

# Activate rollback for errors during deployment.
trap rollback ERR

echo "Updating BACKEND_TAG in .env..."

if grep -q '^BACKEND_TAG=' .env; then
    sed -i "s/^BACKEND_TAG=.*/BACKEND_TAG=$BACKEND_TAG/" .env
else
    printf '\nBACKEND_TAG=%s\n' "$BACKEND_TAG" >> .env
fi

export BACKEND_TAG

echo "Validating Compose configuration..."
docker compose config -q

echo "Pulling all eight backend images..."

docker compose pull \
    backend-backend \
    backend-inventory \
    backend-login \
    backend-pretest \
    backend-qc-inspection \
    backend-rrh \
    backend-smt \
    backend-vacuum-leak-test

echo "Recreating backend services..."

docker compose up -d --no-deps \
    backend-backend \
    backend-inventory \
    backend-login \
    backend-pretest \
    backend-qc-inspection \
    backend-rrh \
    backend-smt \
    backend-vacuum-leak-test

echo "Checking backend containers..."

for service in \
    backend-backend \
    backend-inventory \
    backend-login \
    backend-pretest \
    backend-qc-inspection \
    backend-rrh \
    backend-smt \
    backend-vacuum-leak-test
do
    CONTAINER_ID="$(docker compose ps --status running -q "$service")"

    if [ -z "$CONTAINER_ID" ]; then
        echo "ERROR: $service is not running."
        false
    fi

    echo "OK: $service is running."
done

# Disable rollback after all deployment checks pass.
trap - ERR

rm -f "$BACKUP_FILE"

echo "Production backend deployment completed successfully."

REMOTE_SCRIPT

                        echo "Deployment command completed."

                        # Log out of Docker Hub on the production server.
                        ssh \
                            -i "$SSH_KEY" \
                            -o StrictHostKeyChecking=accept-new \
                            -o ConnectTimeout=15 \
                            "$SSH_USER@$DEPLOY_HOST" \
                            "docker logout" || true

                        echo "Production deployment stage completed."
                    '''
                }
            }
        }
    }

    post {
        success {
            echo """
            SUCCESS: SFCS backend CI/CD completed.

            Git commit: ${env.GIT_COMMIT_FULL}
            Docker tag: ${env.IMAGE_TAG}

            All eight backend images were pushed to Docker Hub.
            The production deployment checks completed successfully.
            """
        }

        failure {
            echo """
            PIPELINE FAILED.

            Review the first error in Console Output.
            Locally built Docker images have been retained for troubleshooting.
            Check the production services before retrying deployment.
            """
        }

        always {
            echo 'SFCS backend CI/CD pipeline execution completed.'
        }
    }
}
