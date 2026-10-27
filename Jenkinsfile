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
        DOCKERHUB_USER  = 'ankithbv007'
        DOCKERHUB_CREDS = 'dockerhub-token'

        IMAGE_PREFIX       = 'ankithbv007/sfcs-unit2-backend'
        LOCAL_IMAGE_PREFIX = 'sfcs-unit2-backend'

        DEPLOY_HOST = '139.84.217.224'
        DEPLOY_DIR  = '/opt/sfcs-unit2'

        SSH_CREDENTIALS_ID = 'sfcs-production-ssh'
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm

                script {
                    env.GIT_COMMIT_SHORT = sh(
                        script: 'git rev-parse --short=12 HEAD',
                        returnStdout: true
                    ).trim()

                    env.IMAGE_TAG = env.GIT_COMMIT_SHORT
                }

                sh '''
                    set -eu

                    echo "Git commit: ${GIT_COMMIT}"
                    echo "Docker image tag: ${IMAGE_TAG}"

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
                        test -f "$service/package.json" || {
                            echo "ERROR: Missing $service/package.json"
                            exit 1
                        }

                        test -f "$service/Dockerfile" || {
                            echo "ERROR: Missing $service/Dockerfile"
                            exit 1
                        }

                        echo "Validated: $service"
                    done
                '''
            }
        }

        stage('Check Docker') {
            steps {
                sh '''
                    set -eu

                    docker version
                    docker buildx version

                    echo "Docker environment is ready."
                '''
            }
        }

        stage('Build All Backend Images') {
            steps {
                script {
                    def services = [
                        'backend-backend',
                        'backend-inventory',
                        'backend-login',
                        'backend-pretest',
                        'backend-qc-inspection',
                        'backend-rrh',
                        'backend-smt',
                        'backend-vacuum-leak-test'
                    ]

                    for (service in services) {
                        stage("Build ${service}") {
                            def image =
                                "${env.LOCAL_IMAGE_PREFIX}-${service}:${env.IMAGE_TAG}"

                            sh """
                                set -eu

                                echo "Building ${service}"
                                echo "Image: ${image}"

                                docker build \
                                    --pull \
                                    --label "org.opencontainers.image.title=${service}" \
                                    --label "org.opencontainers.image.revision=${env.GIT_COMMIT}" \
                                    --label "org.opencontainers.image.version=${env.IMAGE_TAG}" \
                                    -t "${image}" \
                                    "./${service}"

                                docker image inspect "${image}" >/dev/null

                                echo "Build successful: ${image}"
                            """
                        }
                    }
                }
            }
        }

        stage('Push and Verify Docker Hub Images') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: "${DOCKERHUB_CREDS}",
                        usernameVariable: 'DH_USER',
                        passwordVariable: 'DH_TOKEN'
                    )
                ]) {
                    sh '''
                        set -eu

                        echo "$DH_TOKEN" | docker login \
                            --username "$DH_USER" \
                            --password-stdin

                        trap 'docker logout >/dev/null 2>&1 || true' EXIT

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
                            LOCAL_IMAGE="${LOCAL_IMAGE_PREFIX}-${service}:${IMAGE_TAG}"
                            REMOTE_IMAGE="${IMAGE_PREFIX}-${service}:${IMAGE_TAG}"

                            echo "========================================"
                            echo "Pushing: $REMOTE_IMAGE"
                            echo "========================================"

                            docker tag "$LOCAL_IMAGE" "$REMOTE_IMAGE"
                            docker push "$REMOTE_IMAGE"

                            echo "Verifying published image: $REMOTE_IMAGE"

                            docker manifest inspect "$REMOTE_IMAGE" >/dev/null

                            echo "Verified: $REMOTE_IMAGE"
                        done

                        echo "All eight backend images were pushed and verified."
                    '''
                }
            }
        }

        stage('Deploy to Production') {
            steps {
                withCredentials([
                    usernamePassword(
                        credentialsId: "${DOCKERHUB_CREDS}",
                        usernameVariable: 'DH_USER',
                        passwordVariable: 'DH_TOKEN'
                    ),
                    sshUserPrivateKey(
                        credentialsId: "${SSH_CREDENTIALS_ID}",
                        keyFileVariable: 'SSH_KEY',
                        usernameVariable: 'SSH_USER'
                    )
                ]) {
                    sh '''
                        set -eu

                        # Prepare SSH.
                        mkdir -p "$HOME/.ssh"
                        chmod 700 "$HOME/.ssh"
                        touch "$HOME/.ssh/known_hosts"
                        chmod 600 "$HOME/.ssh/known_hosts"

                        # Production recommendation:
                        # Verify the server host-key fingerprint independently.
                        # Do not blindly trust an unverified host key.
                        ssh-keyscan -H "$DEPLOY_HOST" \
                            >> "$HOME/.ssh/known_hosts" 2>/dev/null

                        SSH_OPTIONS="-i $SSH_KEY -o StrictHostKeyChecking=yes -o BatchMode=yes"

                        echo "Checking production SSH access..."

                        ssh $SSH_OPTIONS \
                            "$SSH_USER@$DEPLOY_HOST" \
                            "test -d '$DEPLOY_DIR' && test -f '$DEPLOY_DIR/docker-compose.yml' && test -f '$DEPLOY_DIR/.env'"

                        echo "Logging in to Docker Hub on production..."

                        printf '%s' "$DH_TOKEN" |
                            ssh $SSH_OPTIONS "$SSH_USER@$DEPLOY_HOST" \
                            "docker login --username '$DH_USER' --password-stdin"

                        cleanup_remote_login() {
                            ssh $SSH_OPTIONS "$SSH_USER@$DEPLOY_HOST" \
                                'docker logout >/dev/null 2>&1 || true' \
                                || true
                        }

                        trap cleanup_remote_login EXIT

                        echo "Deploying backend commit: $IMAGE_TAG"

                        ssh $SSH_OPTIONS "$SSH_USER@$DEPLOY_HOST" \
                            "BACKEND_TAG='$IMAGE_TAG' DEPLOY_DIR='$DEPLOY_DIR' bash -s" <<'REMOTE_SCRIPT'
                        set -Eeuo pipefail

                        cd "$DEPLOY_DIR"

                        # Prevent overlapping deployments.
                        exec 9>.deploy.lock
                        flock -n 9 || {
                            echo "ERROR: Another deployment is running."
                            exit 1
                        }

                        test -f docker-compose.yml
                        test -f .env

                        # Validate the Git commit-based tag.
                        if ! [[ "$BACKEND_TAG" =~ ^[0-9a-f]{12}$ ]]; then
                            echo "ERROR: Invalid 12-character Git commit tag."
                            exit 1
                        fi

                        SERVICES="
                        backend-backend
                        backend-inventory
                        backend-login
                        backend-pretest
                        backend-qc-inspection
                        backend-rrh
                        backend-smt
                        backend-vacuum-leak-test
                        "

                        # BACKEND_TAG must already exist in .env.
                        grep -q '^BACKEND_TAG=' .env || {
                            echo "ERROR: BACKEND_TAG is missing from .env."
                            exit 1
                        }

                        # Save the previous environment before changing it.
                        BACKUP_FILE=".env.before-backend-${BACKEND_TAG}"
                        cp -p .env "$BACKUP_FILE"

                        OLD_TAG="$(sed -n 's/^BACKEND_TAG=//p' .env | tail -n 1)"

                        rollback() {
                            rc=$?
                            trap - EXIT

                            if [ "$rc" -ne 0 ]; then
                                echo "Deployment failed."

                                cp -p "$BACKUP_FILE" .env

                                if [[ "$OLD_TAG" =~ ^[0-9a-f]{12}$ ]]; then
                                    echo "Attempting rollback to $OLD_TAG"

                                    docker compose pull $SERVICES || true
                                    docker compose up -d --no-deps $SERVICES || true
                                else
                                    echo "No valid previous commit tag is available for automatic rollback."
                                    echo "The previous .env has been restored."
                                fi
                            fi

                            exit "$rc"
                        }

                        trap rollback EXIT

                        # Update only BACKEND_TAG.
                        sed -i \
                            "s/^BACKEND_TAG=.*/BACKEND_TAG=${BACKEND_TAG}/" \
                            .env

                        echo "Validating Compose configuration..."

                        docker compose config -q

                        echo "Pulling backend images for commit $BACKEND_TAG..."

                        docker compose pull $SERVICES

                        echo "Recreating backend services..."

                        docker compose up -d --no-deps $SERVICES

                        # Verify every service has a running container.
                        for service in $SERVICES; do
                            container_id="$(docker compose ps -q "$service")"

                            if [ -z "$container_id" ]; then
                                echo "ERROR: No container found for $service"
                                exit 1
                            fi

                            running="$(docker inspect \
                                --format '{{.State.Running}}' \
                                "$container_id")"

                            if [ "$running" != "true" ]; then
                                echo "ERROR: $service is not running."

                                docker compose logs \
                                    --tail=80 "$service" || true

                                exit 1
                            fi

                            echo "Running: $service"
                        done

                        echo "Backend deployment completed."

                        docker compose ps

                        trap - EXIT
                        REMOTE_SCRIPT

                        echo "Production deployment completed."
                    '''
                }
            }
        }
    }

    post {
        failure {
            echo 'Pipeline failed. Check the failed stage in Console Output.'

            sh '''
                set +e

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
                    docker image rm \
                        "${LOCAL_IMAGE_PREFIX}-${service}:${IMAGE_TAG}" \
                        >/dev/null 2>&1
                done

                echo "Local build image cleanup attempted."
            '''
        }

        success {
            echo 'SUCCESS: Eight backend images were pushed and production deployment completed.'
        }

        always {
            echo 'Backend CI/CD pipeline execution completed.'
        }
    }
}
