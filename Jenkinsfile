```groovy
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
        DOCKERHUB_CREDS = 'dockerhub-creds'

        IMAGE_PREFIX = 'ankithbv007/new-sfcs-unit2-backend'

        LOCAL_IMAGE_PREFIX = 'new-sfcs-unit2-backend'
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
                }

                sh '''
                    set -eu

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

                        echo "Validated $service"
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

        stage('Build All Microservices') {
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
                                "${env.LOCAL_IMAGE_PREFIX}-${service}:${env.BUILD_NUMBER}"

                            sh """
                                set -eu

                                echo "Building ${service}..."

                                docker build \
                                    --pull \
                                    --label "org.opencontainers.image.title=${service}" \
                                    --label "org.opencontainers.image.revision=${env.GIT_COMMIT}" \
                                    --label "org.opencontainers.image.version=${env.BUILD_NUMBER}" \
                                    --tag "${image}" \
                                    "./${service}"

                                docker image inspect "${image}" >/dev/null

                                echo "Build successful: ${image}"
                            """
                        }
                    }
                }
            }
        }

        stage('Push Images to Docker Hub') {
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
                            LOCAL_IMAGE="${LOCAL_IMAGE_PREFIX}-${service}:${BUILD_NUMBER}"
                            REMOTE_IMAGE="${IMAGE_PREFIX}-${service}:${BUILD_NUMBER}"

                            echo "Pushing ${REMOTE_IMAGE}..."

                            docker tag "$LOCAL_IMAGE" "$REMOTE_IMAGE"
                            docker push "$REMOTE_IMAGE"

                            echo "Push successful: ${REMOTE_IMAGE}"
                        done
                    '''
                }
            }
        }

        stage('Verify Images') {
            steps {
                sh '''
                    set -eu

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
                        IMAGE="${IMAGE_PREFIX}-${service}:${BUILD_NUMBER}"

                        echo "Checking published image: $IMAGE"

                        docker manifest inspect "$IMAGE" >/dev/null
                    done

                    echo "All images verified."
                '''
            }
        }
    }

    post {
        failure {
            echo 'Pipeline failed. Cleaning up temporary local images from this build.'

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
                        "${LOCAL_IMAGE_PREFIX}-${service}:${BUILD_NUMBER}" \
                        >/dev/null 2>&1
                done

                echo "Temporary local image cleanup completed."
            '''
        }

        success {
            echo 'SUCCESS: All backend images were built and pushed.'
        }

        always {
            echo 'Backend pipeline execution completed.'
        }
    }
}
```